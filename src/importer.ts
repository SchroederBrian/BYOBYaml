// YAML → blocks. Known fields become dedicated blocks; everything else becomes
// "Feld" / "zu Liste hinzufügen" / "YAML einmischen" extras so nothing is lost.
import YAML from 'yaml';
import { SPEC_BY_TYPE } from './blocks/defs';
import { b, B, FileKind, ProjectFile, stack, uid, wsState } from './project';

export interface ImportResult {
  file: ProjectFile;
  notes: string[];
}

// ---------- helpers ----------
const isPlain = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const take = (o: any, k: string): any => {
  if (!isPlain(o)) return undefined;
  const v = o[k];
  delete o[k];
  return v;
};
const onlyKeys = (o: any, allowed: string[]) => isPlain(o) && Object.keys(o).every((k) => allowed.includes(k));
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const str = (v: any) => (v === null || v === undefined ? '' : String(v));
const dd = (v: string) => (v === '' ? '__none__' : v);
const isScalarVal = (v: any) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
/** 493 -> "0755" (file permissions are shown octal in the block) */
const octText = (v: any) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? '0' + v.toString(8) : str(v));

// YAML 1.1 style octal ints (0755) like go-yaml (kubectl, oc, docker compose) read them
const OCTAL_INT = {
  identify: () => false,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'OCT',
  test: /^0[0-7]+$/,
  resolve: (s: string) => parseInt(s, 8),
};

/** Parse multi-document YAML the way the cluster tools do (merge keys, 0755 octal, kind: List). */
export function parseYamlDocs(text: string): any[] {
  if (/(?<!\$)\{\{-?\s*[.$a-zA-Z(]/.test(text))
    throw new Error('Helm-Template erkannt ({{ … }}). Bitte zuerst mit "helm template" rendern und das Ergebnis importieren.');
  const parsed = YAML.parseAllDocuments(text, { merge: true, customTags: (tags: any[]) => [OCTAL_INT, ...tags] } as any);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const errors = list.flatMap((d: any) => d.errors);
  if (errors.length) throw new Error(errors[0].message);
  const docs: any[] = list.map((d: any) => d.toJS({ maxAliasCount: -1 })).filter((d) => d !== null && d !== undefined);
  return docs.flatMap((d) => (isPlain(d) && d.kind === 'List' && Array.isArray(d.items) ? d.items : [d]));
}
const WEIRD_KEY = /[.[\]]/;

function ddOk(type: string, field: string, value: any): boolean {
  const arg = SPEC_BY_TYPE[type]?.args?.find((a) => a.name === field);
  return !!arg && arg.kind === 'dd' && arg.options.some(([, v]) => v === value);
}

/** Value → text for an Extras field (plain where unambiguous, else JSON which is valid YAML flow). */
function fmt(v: any): string {
  if (typeof v === 'string') {
    try {
      if (v !== '' && v.trim() === v && !v.includes('${') && YAML.parse(v) === v) return v;
    } catch {
      /* fall through */
    }
  }
  return JSON.stringify(v);
}

const field = (path: string, v: any) => b('x_field', { PATH: path, VAL: fmt(v) });
const listItem = (path: string, v: any) => b('x_list', { PATH: path, VAL: fmt(v) });

/** Nest {k: v} under a dotted prefix for x_yaml (used when keys contain dots). */
function nest(prefix: string, k: string, v: any) {
  let obj: any = { [k]: v };
  for (const p of prefix.split('.').filter(Boolean).reverse()) obj = { [p]: obj };
  return obj;
}

/** Remaining (unconsumed) keys → Extras blocks. */
function leftovers(obj: any, prefix = ''): B[] {
  const out: B[] = [];
  if (!isPlain(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (isPlain(v) && Object.keys(v).length === 0) continue;
    if (WEIRD_KEY.test(k)) {
      out.push(b('x_yaml', { Y: JSON.stringify(nest(prefix, k, v)) }));
      continue;
    }
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlain(v) && !Object.keys(v).some((kk) => WEIRD_KEY.test(kk))) out.push(...leftovers(v, path));
    else out.push(field(path, v));
  }
  return out;
}

/** "a b" → a "b c" quoting so splitArgs() gives back the same list. Null if impossible. */
function joinArgs(list: any[]): string | null {
  const parts: string[] = [];
  for (const raw of list) {
    const s = String(raw);
    if (s !== '' && !/[\s"']/.test(s)) parts.push(s);
    else if (!s.includes('"')) parts.push(`"${s}"`);
    else if (!s.includes("'")) parts.push(`'${s}'`);
    else return null;
  }
  return parts.join(' ');
}

// ---------- cluster noise ----------
const MANAGED_META = ['uid', 'resourceVersion', 'creationTimestamp', 'generation', 'managedFields', 'selfLink', 'ownerReferences'];
const MANAGED_ANN = ['kubectl.kubernetes.io/last-applied-configuration', 'deployment.kubernetes.io/revision', 'openshift.io/generated-by'];

function stripClusterFields(doc: any, notes: Set<string>) {
  if (take(doc, 'status') !== undefined) notes.add('status');
  const meta = doc.metadata;
  if (isPlain(meta)) {
    for (const k of MANAGED_META) if (take(meta, k) !== undefined) notes.add(`metadata.${k}`);
    if (isPlain(meta.annotations)) {
      for (const k of MANAGED_ANN) if (take(meta.annotations, k) !== undefined) notes.add(k);
      if (!Object.keys(meta.annotations).length) delete meta.annotations;
    }
  }
}

// =====================================================================
// Kubernetes / OpenShift
// =====================================================================
const API: Record<string, string> = {
  Namespace: 'v1',
  Deployment: 'apps/v1',
  DeploymentConfig: 'apps.openshift.io/v1',
  StatefulSet: 'apps/v1',
  DaemonSet: 'apps/v1',
  Job: 'batch/v1',
  CronJob: 'batch/v1',
  Service: 'v1',
  Route: 'route.openshift.io/v1',
  Ingress: 'networking.k8s.io/v1',
  ConfigMap: 'v1',
  Secret: 'v1',
  PersistentVolumeClaim: 'v1',
  HorizontalPodAutoscaler: 'autoscaling/v2',
  ImageStream: 'image.openshift.io/v1',
  BuildConfig: 'build.openshift.io/v1',
  ServiceAccount: 'v1',
};

function metaBlocks(meta: any, body: B[], tail: B[]) {
  const ns = take(meta, 'namespace');
  if (ns) body.push(b('meta_namespace', { NS: str(ns) }));
  const labels = take(meta, 'labels');
  if (isPlain(labels)) for (const [k, v] of Object.entries(labels)) body.push(b('meta_label', { K: k, V: str(v) }));
  const ann = take(meta, 'annotations');
  if (isPlain(ann)) for (const [k, v] of Object.entries(ann)) body.push(b('meta_annotation', { K: k, V: str(v) }));
  tail.push(...leftovers(meta, 'metadata'));
}

function importContainer(c: any, notes: Set<string>): { fields: Record<string, any>; body: B[] } {
  const name = str(take(c, 'name'));
  const image = str(take(c, 'image'));
  const body: B[] = [];
  const tail: B[] = [];

  for (const p of take(c, 'ports') ?? []) {
    const proto = p?.protocol ?? 'TCP';
    if (onlyKeys(p, ['containerPort', 'name', 'protocol']) && typeof p.containerPort === 'number' && ddOk('c_port', 'PROTO', proto))
      body.push(b('c_port', { PORT: p.containerPort, NAME: str(p.name), PROTO: proto }));
    else body.push(listItem('ports', p));
  }
  for (const e of take(c, 'env') ?? []) {
    if (onlyKeys(e, ['name', 'value']) && e.value !== null && typeof e.value !== 'object') body.push(b('c_env', { K: e.name, V: str(e.value) }));
    else if (onlyKeys(e, ['name', 'valueFrom']) && isPlain(e.valueFrom) && Object.keys(e.valueFrom).length === 1) {
      const src = Object.keys(e.valueFrom)[0];
      const ref = e.valueFrom[src];
      if ((src === 'secretKeyRef' || src === 'configMapKeyRef') && onlyKeys(ref, ['name', 'key', 'optional']) && ref.optional !== false)
        body.push(b('c_env_ref', { K: e.name, SRC: src, NAME: str(ref.name), KEY: str(ref.key), OPT: ref.optional === true }));
      else if (src === 'fieldRef' && onlyKeys(ref, ['fieldPath', 'apiVersion']) && (ref.apiVersion ?? 'v1') === 'v1' && ddOk('c_env_field', 'PATH', ref.fieldPath))
        body.push(b('c_env_field', { K: e.name, PATH: ref.fieldPath }));
      else if (src === 'resourceFieldRef' && onlyKeys(ref, ['resource', 'containerName']) && ddOk('c_env_resource', 'RES', ref.resource))
        body.push(b('c_env_resource', { K: e.name, RES: ref.resource, CONT: str(ref.containerName) }));
      else body.push(listItem('env', e));
    } else body.push(listItem('env', e));
  }
  for (const e of take(c, 'envFrom') ?? []) {
    const src = isPlain(e) ? (Object.keys(e).find((k) => k !== 'prefix') ?? '') : '';
    if (onlyKeys(e, ['prefix', src]) && (src === 'configMapRef' || src === 'secretRef') && onlyKeys(e[src], ['name', 'optional']) && e[src].optional !== false)
      body.push(b('c_env_from', { SRC: src, NAME: str(e[src].name), PREFIX: str(e.prefix), OPT: e[src].optional === true }));
    else body.push(listItem('envFrom', e));
  }
  const res = c.resources;
  if (isPlain(res)) {
    for (const kind of ['requests', 'limits']) {
      const r = res[kind];
      if (isPlain(r) && (r.cpu !== undefined || r.memory !== undefined)) {
        body.push(b('c_resources', { KIND: kind, CPU: str(take(r, 'cpu')), MEM: str(take(r, 'memory')) }));
      }
    }
  }
  for (const m of take(c, 'volumeMounts') ?? []) {
    if (onlyKeys(m, ['name', 'mountPath', 'readOnly', 'subPath']) && m.readOnly !== false)
      body.push(b('c_mount', { NAME: str(m.name), PATH: str(m.mountPath), RO: !!m.readOnly, SUB: str(m.subPath) }));
    else body.push(listItem('volumeMounts', m));
  }
  for (const [key, type, f] of [
    ['command', 'c_command', 'CMD'],
    ['args', 'c_args', 'ARGS'],
  ] as const) {
    const v = take(c, key);
    if (v === undefined) continue;
    const joined = Array.isArray(v) ? joinArgs(v) : null;
    if (joined !== null && joined !== '') body.push(b(type, { [f]: joined }));
    else tail.push(field(key, v));
  }
  const pull = take(c, 'imagePullPolicy');
  if (pull !== undefined) ddOk('c_pull', 'P', pull) ? body.push(b('c_pull', { P: pull })) : tail.push(field('imagePullPolicy', pull));
  const wd = take(c, 'workingDir');
  if (wd !== undefined) body.push(b('c_workdir', { DIR: str(wd) }));

  for (const kind of ['livenessProbe', 'readinessProbe', 'startupProbe']) {
    const p = take(c, kind);
    if (p === undefined) continue;
    const http = p?.httpGet;
    const tcp = p?.tcpSocket;
    const ex = p?.exec;
    const timing = ['initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold'];
    const ok =
      onlyKeys(p, ['httpGet', 'tcpSocket', ...timing]) &&
      typeof p.initialDelaySeconds === 'number' &&
      typeof p.periodSeconds === 'number' &&
      ((http && !tcp && onlyKeys(http, ['path', 'port', 'scheme']) && http.port !== undefined && [undefined, 'HTTP', 'HTTPS'].includes(http.scheme)) ||
        (tcp && !http && onlyKeys(tcp, ['port'])));
    const exCmd = ex && onlyKeys(p, ['exec', ...timing]) && onlyKeys(ex, ['command']) && Array.isArray(ex.command) ? joinArgs(ex.command) : null;
    if (exCmd)
      body.push(
        b('c_probe_exec', { KIND: kind, CMD: exCmd, DELAY: str(p.initialDelaySeconds), PERIOD: str(p.periodSeconds), TIMEOUT: str(p.timeoutSeconds), FAIL: str(p.failureThreshold) }),
      );
    else if (ok)
      body.push(
        b('c_probe', {
          KIND: kind,
          HOW: http ? (http.scheme === 'HTTPS' ? 'https' : 'http') : 'tcp',
          PATH: http ? str(http.path ?? '/') : '/healthz',
          PORT: str((http ?? tcp).port),
          DELAY: p.initialDelaySeconds,
          PERIOD: p.periodSeconds,
          TIMEOUT: str(p.timeoutSeconds),
          FAIL: str(p.failureThreshold),
        }),
      );
    else tail.push(field(kind, p));
  }
  const lc = c.lifecycle;
  if (isPlain(lc))
    for (const hook of ['preStop', 'postStart']) {
      const h = lc[hook];
      const cmd = onlyKeys(h, ['exec']) && onlyKeys(h.exec, ['command']) && Array.isArray(h.exec.command) ? joinArgs(h.exec.command) : null;
      if (cmd) {
        body.push(b('c_lifecycle', { HOOK: hook, CMD: cmd }));
        delete lc[hook];
      }
    }
  const sc = c.securityContext;
  if (isPlain(sc) && (typeof sc.runAsUser === 'number' || typeof sc.runAsGroup === 'number') && [sc.runAsUser, sc.runAsGroup].every((x) => x === undefined || typeof x === 'number')) {
    body.push(b('c_run_as', { USER: str(take(sc, 'runAsUser')), GROUP: str(take(sc, 'runAsGroup')) }));
  }
  if (
    onlyKeys(sc, ['allowPrivilegeEscalation', 'readOnlyRootFilesystem', 'capabilities']) &&
    typeof sc.allowPrivilegeEscalation === 'boolean' &&
    (sc.readOnlyRootFilesystem === undefined || sc.readOnlyRootFilesystem === true) &&
    (sc.capabilities === undefined || eq(sc.capabilities, { drop: ['ALL'] }))
  ) {
    delete c.securityContext;
    body.push(b('c_security', { NOESC: !sc.allowPrivilegeEscalation, ROFS: !!sc.readOnlyRootFilesystem, DROP: !!sc.capabilities }));
  }
  void notes;
  return { fields: { NAME: name, IMAGE: image }, body: [...body, ...tail, ...leftovers(c)] };
}

function importPod(pod: any, prefix: string, body: B[], tail: B[], notes: Set<string>, defaultRestart?: string) {
  if (!isPlain(pod)) return;
  for (const c of take(pod, 'containers') ?? []) {
    const r = importContainer(c, notes);
    body.push(b('pod_container', r.fields, r.body));
  }
  for (const c of take(pod, 'initContainers') ?? []) {
    const r = importContainer(c, notes);
    body.push(b('pod_init_container', r.fields, r.body));
  }
  for (const s of take(pod, 'imagePullSecrets') ?? []) {
    if (onlyKeys(s, ['name'])) body.push(b('pod_pull_secret', { NAME: str(s.name) }));
    else body.push(listItem(`${prefix}.imagePullSecrets`, s));
  }
  const sa = take(pod, 'serviceAccountName');
  if (sa !== undefined) body.push(b('pod_service_account', { NAME: str(sa) }));
  for (const v of take(pod, 'volumes') ?? []) {
    const keys = isPlain(v) ? Object.keys(v) : [];
    if (keys.length === 2 && v.name) {
      if (onlyKeys(v.persistentVolumeClaim, ['claimName'])) {
        body.push(b('pod_vol_pvc', { NAME: v.name, CLAIM: str(v.persistentVolumeClaim.claimName) }));
        continue;
      }
      const items = (src: any) => {
        const it = src.items;
        if (it === undefined) return '';
        if (!Array.isArray(it) || !it.every((x: any) => onlyKeys(x, ['key', 'path']) && !/[,=]/.test(str(x.key) + str(x.path)))) return null;
        return it.map((x: any) => (x.key === x.path ? x.key : `${x.key}=${x.path}`)).join(', ');
      };
      const modeOk = (m: any) => m === undefined || typeof m === 'number';
      if (onlyKeys(v.configMap, ['name', 'defaultMode', 'items']) && modeOk(v.configMap.defaultMode) && items(v.configMap) !== null) {
        body.push(b('pod_vol_cm', { NAME: v.name, CM: str(v.configMap.name), MODE: octText(v.configMap.defaultMode), ITEMS: items(v.configMap) }));
        continue;
      }
      if (onlyKeys(v.secret, ['secretName', 'defaultMode', 'items']) && modeOk(v.secret.defaultMode) && items(v.secret) !== null) {
        body.push(b('pod_vol_secret', { NAME: v.name, SECRET: str(v.secret.secretName), MODE: octText(v.secret.defaultMode), ITEMS: items(v.secret) }));
        continue;
      }
      if (onlyKeys(v.hostPath, ['path', 'type']) && (v.hostPath.type === undefined || ddOk('pod_vol_host', 'TYPE', v.hostPath.type))) {
        body.push(b('pod_vol_host', { NAME: v.name, PATH: str(v.hostPath.path), TYPE: dd(str(v.hostPath.type)) }));
        continue;
      }
      if (isPlain(v.emptyDir) && (eq(v.emptyDir, {}) || eq(v.emptyDir, { medium: 'Memory' }))) {
        body.push(b('pod_vol_empty', { NAME: v.name, MEM: v.emptyDir.medium === 'Memory' }));
        continue;
      }
    }
    body.push(listItem(`${prefix}.volumes`, v));
  }
  const ns = take(pod, 'nodeSelector');
  if (isPlain(ns)) for (const [k, v] of Object.entries(ns)) body.push(b('pod_node_selector', { K: k, V: str(v) }));
  const rp = take(pod, 'restartPolicy');
  if (rp !== undefined && rp !== defaultRestart) body.push(b('pod_restart_policy', { R: rp }));
  const sc = pod.securityContext;
  if (onlyKeys(sc, ['runAsNonRoot', 'fsGroup', 'runAsUser', 'runAsGroup']) && typeof sc.runAsNonRoot === 'boolean' && [sc.fsGroup, sc.runAsUser, sc.runAsGroup].every((x) => x === undefined || typeof x === 'number')) {
    delete pod.securityContext;
    body.push(b('pod_security', { NONROOT: sc.runAsNonRoot, FSGROUP: str(sc.fsGroup), USER: str(sc.runAsUser), GROUP: str(sc.runAsGroup) }));
  }
  for (const t of take(pod, 'tolerations') ?? []) {
    const op = t?.operator ?? 'Equal';
    if (onlyKeys(t, ['key', 'operator', 'value', 'effect']) && ddOk('pod_toleration', 'OP', op) && (t.effect === undefined || ddOk('pod_toleration', 'EFFECT', t.effect)) && !(op === 'Exists' && t.value !== undefined) && (t.key !== undefined || op === 'Exists'))
      body.push(b('pod_toleration', { KEY: str(t.key), OP: op, VAL: str(t.value), EFFECT: dd(str(t.effect)) }));
    else body.push(listItem(`${prefix}.tolerations`, t));
  }
  const grace = take(pod, 'terminationGracePeriodSeconds');
  if (typeof grace === 'number') body.push(b('pod_grace', { S: grace }));
  tail.push(...leftovers(pod, prefix));
}

/** Pod template labels/annotations; returns true if default {app: name} label matched. */
function importTemplateMeta(tmeta: any, name: string, path: string, body: B[], tail: B[]) {
  const labels = take(tmeta, 'labels') ?? {};
  if (labels.app === name) {
    delete labels.app;
    for (const [k, v] of Object.entries(labels)) body.push(b('pod_label', { K: k, V: str(v) }));
  } else {
    tail.push(field(`${path}.labels`, labels));
  }
  const ann = take(tmeta, 'annotations');
  if (isPlain(ann)) for (const [k, v] of Object.entries(ann)) body.push(b('pod_annotation', { K: k, V: str(v) }));
  tail.push(...leftovers(tmeta, path));
}

/** pullSecret / noCache / forcePull / from / env of a build strategy → blocks (consumed keys are removed). */
function strategyExtras(inner: any, body: B[]) {
  if (!isPlain(inner)) return;
  if (onlyKeys(inner.from, ['kind', 'name']) && ddOk('bc_docker_from', 'KIND', inner.from.kind)) body.push(b('bc_docker_from', { KIND: inner.from.kind, NAME: str(take(inner, 'from').name) }));
  if (onlyKeys(inner.pullSecret, ['name'])) body.push(b('bc_pull_secret', { S: str(take(inner, 'pullSecret').name) }));
  const nc = inner.noCache;
  const fp = inner.forcePull;
  if ((nc === true || fp === true) && [nc, fp].every((x) => x === undefined || x === true)) {
    delete inner.noCache;
    delete inner.forcePull;
    body.push(b('bc_strategy_opts', { NOCACHE: nc === true, FORCE: fp === true }));
  }
  const env = inner.env;
  if (Array.isArray(env) && env.every((a: any) => onlyKeys(a, ['name', 'value']) && typeof a.value !== 'object')) {
    delete inner.env;
    for (const a of env) body.push(b('bc_strategy_env', { K: a.name, V: str(a.value) }));
  }
}

function importK8sDoc(doc: any, notes: Set<string>): any {
  stripClusterFields(doc, notes);
  const kind = str(take(doc, 'kind'));
  const api = str(take(doc, 'apiVersion'));
  const meta = take(doc, 'metadata') ?? {};
  const name = str(take(meta, 'name')) || 'unbenannt';
  const body: B[] = [];
  const tail: B[] = [];
  metaBlocks(meta, body, tail);

  let hat: B;
  const known = API[kind] === api;
  const spec = isPlain(doc.spec) ? take(doc, 'spec') : undefined;

  if (!known) {
    hat = b('k8s_custom', { NAME: name, KIND: kind || 'Unknown', API: api || 'v1' });
    if (spec !== undefined) tail.push(...(Object.keys(spec).length ? leftovers(spec, 'spec') : [field('spec', {})]));
  } else if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet') {
    const s = spec ?? {};
    const fields: any = { NAME: name };
    if (kind !== 'DaemonSet') fields.REPLICAS = take(s, 'replicas') ?? 1;
    if (kind === 'StatefulSet') fields.SVC = str(take(s, 'serviceName'));
    hat = b(`k8s_${kind.toLowerCase()}`, fields);
    const sel = take(s, 'selector');
    if (!eq(sel, { matchLabels: { app: name } })) tail.push(field('spec.selector', sel ?? null));
    const strat = take(s, 'strategy');
    if (strat !== undefined) {
      if (kind === 'Deployment' && onlyKeys(strat, ['type']) && ddOk('pod_strategy', 'S', strat.type)) body.push(b('pod_strategy', { S: strat.type }));
      else tail.push(field('spec.strategy', strat));
    }
    if (kind === 'StatefulSet') {
      const vcts = take(s, 'volumeClaimTemplates') ?? [];
      for (const v of vcts) {
        const size = v?.spec?.resources?.requests?.storage;
        if (onlyKeys(v, ['metadata', 'spec']) && onlyKeys(v.metadata, ['name']) && eq(v.spec, { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: size } } }))
          body.push(b('sts_volume_claim', { NAME: str(v.metadata.name), SIZE: str(size) }));
        else body.push(listItem('spec.volumeClaimTemplates', v));
      }
    }
    const tpl = take(s, 'template') ?? {};
    importTemplateMeta(take(tpl, 'metadata') ?? {}, name, 'spec.template.metadata', body, tail);
    importPod(take(tpl, 'spec'), 'spec.template.spec', body, tail, notes);
    tail.push(...leftovers(tpl, 'spec.template'), ...leftovers(s, 'spec'));
  } else if (kind === 'DeploymentConfig') {
    const s = spec ?? {};
    hat = b('k8s_deploymentconfig', { NAME: name, REPLICAS: take(s, 'replicas') ?? 1 });
    const sel = take(s, 'selector');
    if (!eq(sel, { app: name })) tail.push(field('spec.selector', sel ?? null));
    const strat = take(s, 'strategy');
    if (strat !== undefined) {
      const rp = strat?.rollingParams;
      const cp = strat?.recreateParams;
      const okRolling = strat?.type === 'Rolling' && onlyKeys(strat, ['type', 'rollingParams']) && (rp === undefined || onlyKeys(rp, ['updatePeriodSeconds', 'intervalSeconds', 'timeoutSeconds', 'maxUnavailable', 'maxSurge']));
      const okRecreate = strat?.type === 'Recreate' && onlyKeys(strat, ['type', 'recreateParams']) && (cp === undefined || onlyKeys(cp, ['timeoutSeconds']));
      if (okRolling)
        body.push(b('dc_strategy', { S: 'Rolling', INTERVAL: str(rp?.intervalSeconds), UPDATE: str(rp?.updatePeriodSeconds), TIMEOUT: str(rp?.timeoutSeconds), UNAVAIL: str(rp?.maxUnavailable), SURGE: str(rp?.maxSurge) }));
      else if (okRecreate) body.push(b('dc_strategy', { S: 'Recreate', INTERVAL: '', UPDATE: '', TIMEOUT: str(cp?.timeoutSeconds), UNAVAIL: '', SURGE: '' }));
      else tail.push(field('spec.strategy', strat));
    }
    for (const t of take(s, 'triggers') ?? []) {
      const ip = t?.imageChangeParams;
      if (eq(t, { type: 'ConfigChange' })) body.push(b('dc_trigger', { T: 'ConfigChange', IST: '', CONT: '' }));
      else if (
        t?.type === 'ImageChange' &&
        onlyKeys(t, ['type', 'imageChangeParams']) &&
        onlyKeys(ip, ['automatic', 'containerNames', 'from']) &&
        ip.automatic === true &&
        onlyKeys(ip.from, ['kind', 'name']) &&
        ip.from.kind === 'ImageStreamTag' &&
        (ip.containerNames === undefined || (Array.isArray(ip.containerNames) && ip.containerNames.length === 1))
      )
        body.push(b('dc_trigger', { T: 'ImageChange', IST: str(ip.from.name), CONT: str(ip.containerNames?.[0]) }));
      else body.push(listItem('spec.triggers', t));
    }
    const tpl = take(s, 'template') ?? {};
    importTemplateMeta(take(tpl, 'metadata') ?? {}, name, 'spec.template.metadata', body, tail);
    importPod(take(tpl, 'spec'), 'spec.template.spec', body, tail, notes);
    tail.push(...leftovers(tpl, 'spec.template'), ...leftovers(s, 'spec'));
  } else if (kind === 'Job' || kind === 'CronJob') {
    const s = spec ?? {};
    let jobSpec = s;
    let base = 'spec';
    if (kind === 'CronJob') {
      hat = b('k8s_cronjob', { NAME: name, SCHEDULE: str(take(s, 'schedule')) });
      const jt = take(s, 'jobTemplate') ?? {};
      jobSpec = take(jt, 'spec') ?? {};
      base = 'spec.jobTemplate.spec';
      tail.push(...leftovers(jt, 'spec.jobTemplate'));
    } else {
      hat = b('k8s_job', { NAME: name, BACKOFF: take(s, 'backoffLimit') ?? 6 });
    }
    if (kind === 'CronJob' && jobSpec.backoffLimit !== undefined) tail.push(field(`${base}.backoffLimit`, take(jobSpec, 'backoffLimit')));
    const tpl = take(jobSpec, 'template') ?? {};
    importTemplateMeta(take(tpl, 'metadata') ?? {}, name, `${base}.template.metadata`, body, tail);
    importPod(take(tpl, 'spec'), `${base}.template.spec`, body, tail, notes, kind === 'Job' ? 'Never' : 'OnFailure');
    tail.push(...leftovers(tpl, `${base}.template`), ...leftovers(jobSpec, base));
    if (kind === 'CronJob') tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'Service') {
    const s = spec ?? {};
    const sel = take(s, 'selector') ?? {};
    const app = take(sel, 'app');
    const type = take(s, 'type') ?? 'ClusterIP';
    hat = b('k8s_service', { NAME: name, APP: str(app), TYPE: ddOk('k8s_service', 'TYPE', type) ? type : 'ClusterIP' });
    if (!ddOk('k8s_service', 'TYPE', type)) tail.push(field('spec.type', type));
    for (const [k, v] of Object.entries(sel)) body.push(b('svc_k8s_selector', { K: k, V: str(v) }));
    if (s.clusterIP === 'None') {
      delete s.clusterIP;
      body.push(b('svc_k8s_headless', {}));
    }
    if (type === 'ExternalName' && typeof s.externalName === 'string') body.push(b('svc_k8s_external', { HOST: take(s, 'externalName') }));
    for (const p of take(s, 'ports') ?? []) {
      const proto = p?.protocol ?? 'TCP';
      if (onlyKeys(p, ['name', 'port', 'targetPort', 'protocol', 'nodePort']) && typeof p.port === 'number' && ddOk('svc_k8s_port', 'PROTO', proto)) {
        body.push(b('svc_k8s_port', { PORT: p.port, TARGET: str(p.targetPort), NAME: str(p.name), PROTO: proto }));
        if (p.nodePort) body.push(b('svc_k8s_nodeport', { NP: p.nodePort, PORT: p.port }));
      } else body.push(listItem('spec.ports', p));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'Route') {
    const s = spec ?? {};
    const to = take(s, 'to') ?? {};
    const toKind = take(to, 'kind');
    const port = take(s, 'port');
    hat = b('k8s_route', { NAME: name, SVC: str(take(to, 'name')), PORT: str(isPlain(port) ? take(port, 'targetPort') : '') });
    if (toKind && toKind !== 'Service') tail.push(field('spec.to.kind', toKind));
    tail.push(...leftovers(to, 'spec.to'), ...leftovers(port, 'spec.port'));
    const host = take(s, 'host');
    if (host !== undefined) body.push(b('route_host', { HOST: str(host) }));
    const path = take(s, 'path');
    if (path !== undefined) body.push(b('route_path', { PATH: str(path) }));
    const tls = take(s, 'tls');
    if (tls !== undefined) {
      if (onlyKeys(tls, ['termination', 'insecureEdgeTerminationPolicy']) && ddOk('route_tls', 'TERM', tls.termination) && ddOk('route_tls', 'INSEC', tls.insecureEdgeTerminationPolicy))
        body.push(b('route_tls', { TERM: tls.termination, INSEC: tls.insecureEdgeTerminationPolicy }));
      else tail.push(field('spec.tls', tls));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'Ingress') {
    const s = spec ?? {};
    hat = b('k8s_ingress', { NAME: name, CLASS: str(take(s, 'ingressClassName')) });
    for (const t of take(s, 'tls') ?? []) {
      if (onlyKeys(t, ['hosts', 'secretName']) && Array.isArray(t.hosts) && t.hosts.length === 1) body.push(b('ingress_tls', { HOST: str(t.hosts[0]), SECRET: str(t.secretName) }));
      else body.push(listItem('spec.tls', t));
    }
    for (const r of take(s, 'rules') ?? []) {
      const paths = r?.http?.paths;
      const simple =
        onlyKeys(r, ['host', 'http']) &&
        onlyKeys(r.http, ['paths']) &&
        Array.isArray(paths) &&
        paths.every((p: any) => {
          const svc = p?.backend?.service;
          return (
            onlyKeys(p, ['path', 'pathType', 'backend']) &&
            ddOk('ingress_rule', 'PTYPE', p.pathType) &&
            onlyKeys(p.backend, ['service']) &&
            onlyKeys(svc, ['name', 'port']) &&
            Object.keys(svc.port ?? {}).length === 1 &&
            (typeof svc.port.number === 'number' || typeof svc.port.name === 'string')
          );
        });
      if (simple)
        for (const p of paths)
          body.push(b('ingress_rule', { HOST: str(r.host), PATH: str(p.path ?? '/'), SVC: str(p.backend.service.name), PORT: str(p.backend.service.port.number ?? p.backend.service.port.name), PTYPE: p.pathType }));
      else body.push(listItem('spec.rules', r));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'ConfigMap') {
    hat = b('k8s_configmap', { NAME: name });
    for (const [k, v] of Object.entries(take(doc, 'data') ?? {})) body.push(b('data_entry', { K: k, V: str(v) }));
    for (const [k, v] of Object.entries(take(doc, 'binaryData') ?? {})) body.push(b('data_base64', { K: k, V: str(v) }));
  } else if (kind === 'Secret') {
    const type = take(doc, 'type') ?? 'Opaque';
    hat = b('k8s_secret', { NAME: name, TYPE: ddOk('k8s_secret', 'TYPE', type) ? type : 'Opaque' });
    if (!ddOk('k8s_secret', 'TYPE', type)) tail.push(field('type', type));
    for (const [k, v] of Object.entries(take(doc, 'stringData') ?? {})) body.push(b('data_entry', { K: k, V: str(v) }));
    for (const [k, v] of Object.entries(take(doc, 'data') ?? {})) body.push(b('data_base64', { K: k, V: str(v) }));
  } else if (kind === 'PersistentVolumeClaim') {
    const s = spec ?? {};
    const modes = take(s, 'accessModes') ?? [];
    const single = Array.isArray(modes) && modes.length === 1 && ddOk('k8s_pvc', 'MODE', modes[0]);
    const res = s.resources;
    const size = res?.requests?.storage;
    if (size !== undefined) delete res.requests.storage;
    hat = b('k8s_pvc', { NAME: name, SIZE: str(size ?? '1Gi'), MODE: single ? modes[0] : 'ReadWriteOnce' });
    if (!single) tail.push(field('spec.accessModes', modes));
    const sc = take(s, 'storageClassName');
    if (sc !== undefined) body.push(b('pvc_class', { SC: str(sc) }));
    const vm = take(s, 'volumeMode');
    if (vm !== undefined) body.push(b('pvc_mode', { M: vm }));
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'HorizontalPodAutoscaler') {
    const s = spec ?? {};
    const ref = take(s, 'scaleTargetRef') ?? {};
    const std = ref.apiVersion === 'apps/v1' && ref.kind === 'Deployment' && onlyKeys(ref, ['apiVersion', 'kind', 'name']);
    hat = b('k8s_hpa', { NAME: name, TARGET: str(ref.name), MIN: take(s, 'minReplicas') ?? 1, MAX: take(s, 'maxReplicas') ?? 1 });
    if (!std) tail.push(field('spec.scaleTargetRef', ref));
    for (const m of take(s, 'metrics') ?? []) {
      const r = m?.resource;
      if (
        onlyKeys(m, ['type', 'resource']) &&
        m.type === 'Resource' &&
        onlyKeys(r, ['name', 'target']) &&
        ['cpu', 'memory'].includes(r.name) &&
        onlyKeys(r.target, ['type', 'averageUtilization']) &&
        r.target.type === 'Utilization'
      )
        body.push(b('hpa_metric', { RES: r.name, PCT: r.target.averageUtilization }));
      else body.push(listItem('spec.metrics', m));
    }
    const win = s.behavior?.scaleDown?.stabilizationWindowSeconds;
    if (typeof win === 'number') {
      delete s.behavior.scaleDown.stabilizationWindowSeconds;
      body.push(b('hpa_behavior', { S: win }));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'ImageStream') {
    const s = spec ?? {};
    const lp = take(s, 'lookupPolicy');
    hat = b('k8s_imagestream', { NAME: name, LOCAL: !!lp?.local });
    if (isPlain(lp)) tail.push(...leftovers((delete lp.local, lp), 'spec.lookupPolicy'));
    for (const t of take(s, 'tags') ?? []) {
      if (onlyKeys(t, ['name', 'from']) && onlyKeys(t.from, ['kind', 'name']) && t.from.kind === 'DockerImage') body.push(b('is_tag', { TAG: str(t.name), FROM: str(t.from.name) }));
      else body.push(listItem('spec.tags', t));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'BuildConfig') {
    const s = spec ?? {};
    const run = take(s, 'runPolicy') ?? 'Serial';
    const out = take(s, 'output');
    const outStd = onlyKeys(out, ['to']) && onlyKeys(out.to, ['kind', 'name']) && out.to.kind === 'ImageStreamTag';
    const labelsOk = (l: any) => l === undefined || (Array.isArray(l) && l.every((x: any) => onlyKeys(x, ['name', 'value']) && typeof x.value !== 'object'));
    const outExt =
      !outStd &&
      onlyKeys(out, ['to', 'pushSecret', 'imageLabels']) &&
      onlyKeys(out.to, ['kind', 'name']) &&
      ddOk('bc_output', 'KIND', out.to.kind) &&
      (out.pushSecret === undefined || onlyKeys(out.pushSecret, ['name'])) &&
      labelsOk(out.imageLabels);
    hat = b('k8s_buildconfig', { NAME: name, OUT: outStd ? str(out.to.name) : '', RUN: ddOk('k8s_buildconfig', 'RUN', run) ? run : 'Serial' });
    if (outExt) {
      body.push(b('bc_output', { KIND: out.to.kind, NAME: str(out.to.name), SECRET: str(out.pushSecret?.name) }));
      for (const l of out.imageLabels ?? []) body.push(b('bc_output_label', { K: l.name, V: str(l.value) }));
    } else if (!outStd && out !== undefined) tail.push(field('spec.output', out));
    if (!ddOk('k8s_buildconfig', 'RUN', run)) tail.push(field('spec.runPolicy', run));
    const src = take(s, 'source');
    if (src !== undefined) {
      if (typeof src?.dockerfile === 'string' && (src.type === 'Dockerfile' || src.type === 'Git')) {
        body.push(b('bc_dockerfile', { TEXT: src.dockerfile }));
        delete src.dockerfile;
        if (src.type === 'Dockerfile') delete src.type;
      }
      if (src?.type === 'Git' && onlyKeys(src.git, ['uri', 'ref'])) {
        body.push(b('bc_git', { URI: str(src.git.uri), REF: str(src.git.ref), DIR: str(src.contextDir) }));
        if (onlyKeys(src.sourceSecret, ['name'])) body.push(b('bc_source_secret', { S: str(src.sourceSecret.name) }));
        else if (src.sourceSecret) tail.push(field('spec.source.sourceSecret', src.sourceSecret));
        for (const k of ['type', 'git', 'contextDir', 'sourceSecret']) delete src[k];
        tail.push(...leftovers(src, 'spec.source'));
      } else if (Object.keys(src ?? {}).length) tail.push(field('spec.source', src));
    }
    const st = take(s, 'strategy');
    if (st !== undefined) {
      const ds = st?.dockerStrategy;
      const ss = st?.sourceStrategy;
      const argsOk = (list: any) => list === undefined || (Array.isArray(list) && list.every((a: any) => onlyKeys(a, ['name', 'value']) && typeof a.value !== 'object'));
      if (st.type === 'Docker' && onlyKeys(st, ['type', 'dockerStrategy']) && (ds === undefined || isPlain(ds)) && argsOk(ds?.buildArgs)) {
        body.push(b('bc_docker', { FILE: str(ds?.dockerfilePath ?? 'Dockerfile') }));
        for (const a of ds?.buildArgs ?? []) body.push(b('bc_build_arg', { K: a.name, V: str(a.value) }));
        if (ds) for (const k of ['dockerfilePath', 'buildArgs']) delete ds[k];
        strategyExtras(ds, body);
        tail.push(...leftovers(ds, 'spec.strategy.dockerStrategy'));
      } else if (st.type === 'Source' && onlyKeys(st, ['type', 'sourceStrategy']) && isPlain(ss) && onlyKeys(ss.from, ['kind', 'name', 'namespace']) && ss.from.kind === 'ImageStreamTag' && argsOk(ss.env)) {
        body.push(b('bc_s2i', { IST: str(ss.from.name), NS: str(ss.from.namespace) }));
        for (const a of ss.env ?? []) body.push(b('bc_build_arg', { K: a.name, V: str(a.value) }));
        for (const k of ['from', 'env']) delete ss[k];
        strategyExtras(ss, body);
        tail.push(...leftovers(ss, 'spec.strategy.sourceStrategy'));
      } else tail.push(field('spec.strategy', st));
    }
    for (const t of take(s, 'triggers') ?? []) {
      const hook: Record<string, string> = { GitHub: 'github', GitLab: 'gitlab', Generic: 'generic' };
      if (eq(t, { type: 'ConfigChange' })) body.push(b('bc_trigger', { T: 'ConfigChange', SECRET: '' }));
      else if (eq(t, { type: 'ImageChange', imageChange: {} })) body.push(b('bc_trigger', { T: 'ImageChange', SECRET: '' }));
      else if (hook[t?.type] && onlyKeys(t, ['type', hook[t.type]]) && onlyKeys(t[hook[t.type]], ['secretReference']) && onlyKeys(t[hook[t.type]].secretReference, ['name']))
        body.push(b('bc_trigger', { T: t.type, SECRET: str(t[hook[t.type]].secretReference.name) }));
      else body.push(listItem('spec.triggers', t));
    }
    const res = take(s, 'resources');
    if (res !== undefined) {
      if (onlyKeys(res, ['limits']) && onlyKeys(res.limits, ['cpu', 'memory'])) body.push(b('bc_resources', { CPU: str(res.limits.cpu), MEM: str(res.limits.memory) }));
      else tail.push(field('spec.resources', res));
    }
    const okH = s.successfulBuildsHistoryLimit;
    const failH = s.failedBuildsHistoryLimit;
    if ([okH, failH].some((x) => x !== undefined) && [okH, failH].every((x) => x === undefined || typeof x === 'number')) {
      body.push(b('bc_history', { OK: str(take(s, 'successfulBuildsHistoryLimit')), FAIL: str(take(s, 'failedBuildsHistoryLimit')) }));
    }
    if (typeof s.completionDeadlineSeconds === 'number') body.push(b('bc_deadline', { S: str(take(s, 'completionDeadlineSeconds')) }));
    if (onlyKeys(s.postCommit, ['script']) && typeof s.postCommit.script === 'string') body.push(b('bc_post_commit', { SCRIPT: take(s, 'postCommit').script }));
    const bns = s.nodeSelector;
    if (isPlain(bns) && Object.values(bns).every((x) => typeof x === 'string')) {
      delete s.nodeSelector;
      for (const [k, v] of Object.entries(bns)) body.push(b('bc_node_selector', { K: k, V: v as string }));
    }
    tail.push(...leftovers(s, 'spec'));
  } else if (kind === 'Namespace') {
    hat = b('k8s_namespace', { NAME: name });
    if (spec) tail.push(...leftovers(spec, 'spec'));
  } else {
    hat = b('k8s_serviceaccount', { NAME: name });
    if (spec) tail.push(...leftovers(spec, 'spec'));
  }

  tail.push(...leftovers(doc));
  return { hat, children: [...body, ...tail] };
}

// =====================================================================
// Docker Compose
// =====================================================================
const SVC_OPTIONS = ['container_name', 'hostname', 'user', 'working_dir', 'platform', 'pull_policy', 'stop_signal', 'stop_grace_period', 'shm_size', 'network_mode', 'domainname'];
const SVC_FLAGS = ['privileged', 'tty', 'stdin_open', 'init', 'read_only'];

function kvList(v: any): [string, any][] {
  if (isPlain(v)) return Object.entries(v);
  if (Array.isArray(v))
    return v.map((s) => {
      const t = String(s);
      const i = t.indexOf('=');
      return i < 0 ? [t, null] : [t.slice(0, i), t.slice(i + 1)];
    });
  return [];
}

function importService(name: string, svc: any): B {
  const s = isPlain(svc) ? svc : {};
  const image = str(take(s, 'image'));
  const body: B[] = [];
  const tail: B[] = [];

  const build = take(s, 'build');
  if (typeof build === 'string') body.push(b('svc_build', { CTX: build, FILE: 'Dockerfile' }));
  else if (isPlain(build)) {
    body.push(b('svc_build', { CTX: str(take(build, 'context') ?? '.'), FILE: str(take(build, 'dockerfile') ?? 'Dockerfile') }));
    for (const [k, v] of kvList(take(build, 'args'))) body.push(b('svc_build_arg', { K: k, V: str(v) }));
    if (typeof build.target === 'string') body.push(b('svc_build_target', { TARGET: take(build, 'target') }));
    if (Array.isArray(build.cache_from) && build.cache_from.every((x: any) => typeof x === 'string'))
      for (const f of take(build, 'cache_from')) body.push(b('svc_build_cache', { FROM: f }));
    tail.push(...leftovers(build, 'build'));
  }
  for (const p of take(s, 'ports') ?? []) {
    if (typeof p === 'number') body.push(b('svc_port', { HOST: '', CONT: String(p), PROTO: 'tcp' }));
    else if (typeof p === 'string' && /^[^/]+(\/(tcp|udp))?$/.test(p)) {
      const [main, proto = 'tcp'] = p.split('/');
      const i = main.lastIndexOf(':');
      body.push(b('svc_port', { HOST: i < 0 ? '' : main.slice(0, i), CONT: i < 0 ? main : main.slice(i + 1), PROTO: proto }));
    } else if (onlyKeys(p, ['target', 'published', 'protocol', 'host_ip']) && p.target !== undefined && ['tcp', 'udp', undefined].includes(p.protocol) && (p.host_ip === undefined || p.published !== undefined)) {
      const host = p.published === undefined ? '' : p.host_ip ? `${p.host_ip}:${p.published}` : str(p.published);
      body.push(b('svc_port', { HOST: host, CONT: str(p.target), PROTO: p.protocol ?? 'tcp' }));
    } else body.push(listItem('ports', p));
  }
  for (const e of take(s, 'expose') ?? []) body.push(b('svc_expose', { PORT: str(e) }));
  for (const [k, v] of kvList(take(s, 'environment'))) {
    if (v === null) body.push(b('svc_env_pass', { K: k }));
    else body.push(b('svc_env', { K: k, V: str(v) }));
  }
  const envFile = take(s, 'env_file');
  for (const f of envFile === undefined ? [] : Array.isArray(envFile) ? envFile : [envFile]) {
    if (typeof f === 'string') body.push(b('svc_env_file', { FILE: f, REQ: true }));
    else if (onlyKeys(f, ['path', 'required']) && typeof f.path === 'string' && [undefined, true, false].includes(f.required)) body.push(b('svc_env_file', { FILE: f.path, REQ: f.required !== false }));
    else body.push(listItem('env_file', f));
  }
  for (const v of take(s, 'volumes') ?? []) {
    const parts = typeof v === 'string' ? v.split(':') : [];
    if (parts.length === 2 || (parts.length === 3 && parts[2] === 'ro')) body.push(b('svc_volume', { SRC: parts[0], DST: parts[1], RO: parts[2] === 'ro' }));
    else if (onlyKeys(v, ['type', 'source', 'target', 'read_only']) && ['bind', 'volume'].includes(v.type) && typeof v.source === 'string' && typeof v.target === 'string' && !/:/.test(v.source + v.target) && v.read_only !== false)
      body.push(b('svc_volume', { SRC: v.source, DST: v.target, RO: v.read_only === true }));
    else if (onlyKeys(v, ['type', 'target', 'tmpfs']) && v.type === 'tmpfs' && typeof v.target === 'string' && (v.tmpfs === undefined || (onlyKeys(v.tmpfs, ['size']) && v.tmpfs.size !== undefined)))
      body.push(b('svc_tmpfs', { PATH: v.target, SIZE: str(v.tmpfs?.size) || '' }));
    else body.push(listItem('volumes', v));
  }
  const dep = take(s, 'depends_on');
  if (Array.isArray(dep)) for (const d of dep) body.push(b('svc_depends', { NAME: str(d), COND: 'service_started' }));
  else if (isPlain(dep))
    for (const [d, cfg] of Object.entries(dep)) {
      const dc = cfg as any;
      if (onlyKeys(dc, ['condition', 'restart', 'required']) && ddOk('svc_depends', 'COND', dc.condition) && [undefined, true, false].includes(dc.restart) && [undefined, true, false].includes(dc.required))
        body.push(b('svc_depends', { NAME: d, COND: dc.condition, RESTART: dc.restart === true, REQUIRED: dc.required !== false }));
      else tail.push(b('x_yaml', { Y: JSON.stringify({ depends_on: { [d]: cfg } }) }));
    }
  const restart = take(s, 'restart');
  const rMax = typeof restart === 'string' ? /^on-failure:(\d+)$/.exec(restart) : null;
  if (rMax) body.push(b('svc_restart_max', { N: Number(rMax[1]) }));
  else if (restart !== undefined) ddOk('svc_restart', 'R', restart) ? body.push(b('svc_restart', { R: restart })) : tail.push(field('restart', restart));
  for (const [key, type] of [
    ['command', 'svc_command'],
    ['entrypoint', 'svc_entrypoint'],
  ] as const) {
    const v = take(s, key);
    if (v === undefined) continue;
    const text = Array.isArray(v) ? joinArgs(v) : typeof v === 'string' ? v : null;
    if (text) body.push(b(type, { CMD: text }));
    else tail.push(field(key, v));
  }
  const nets = take(s, 'networks');
  if (Array.isArray(nets)) for (const n of nets) body.push(b('svc_network', { NAME: str(n) }));
  else if (isPlain(nets))
    for (const [n, cfg] of Object.entries(nets)) {
      const nc = cfg as any;
      if (cfg === null || (isPlain(cfg) && !Object.keys(cfg).length)) body.push(b('svc_network', { NAME: n, ALIASES: '', IP: '' }));
      else if (
        onlyKeys(nc, ['aliases', 'ipv4_address', 'ipv6_address']) &&
        !(nc.ipv4_address && nc.ipv6_address) &&
        (nc.aliases === undefined || (Array.isArray(nc.aliases) && nc.aliases.length > 0 && nc.aliases.every((a: any) => typeof a === 'string' && !a.includes(','))))
      )
        body.push(b('svc_network', { NAME: n, ALIASES: (nc.aliases ?? []).join(', '), IP: str(nc.ipv4_address ?? nc.ipv6_address) }));
      else tail.push(b('x_yaml', { Y: JSON.stringify({ networks: { [n]: cfg } }) }));
    }
  const hc = take(s, 'healthcheck');
  if (hc !== undefined) {
    const t = hc?.test;
    let mode: 'CMD' | 'CMD-SHELL' | null = null;
    let cmd: string | null = null;
    if (Array.isArray(t) && t[0] === 'CMD-SHELL' && t.length === 2) [mode, cmd] = ['CMD-SHELL', String(t[1])];
    else if (Array.isArray(t) && t[0] === 'CMD' && t.length > 1) [mode, cmd] = ['CMD', joinArgs(t.slice(1))];
    if (eq(hc, { disable: true })) body.push(b('svc_healthcheck_off', {}));
    else if (mode && cmd !== null && onlyKeys(hc, ['test', 'interval', 'timeout', 'retries', 'start_period', 'start_interval']) && (hc.retries === undefined || typeof hc.retries === 'number'))
      body.push(b('svc_healthcheck', { MODE: mode, CMD: cmd, INT: str(hc.interval), TO: str(hc.timeout), RET: str(hc.retries), START: str(hc.start_period), SINT: str(hc.start_interval) }));
    else tail.push(field('healthcheck', hc));
  }
  for (const [k, v] of kvList(take(s, 'labels'))) body.push(b('svc_label', { K: k, V: str(v) }));
  const deploy = take(s, 'deploy');
  if (isPlain(deploy)) {
    const rep = take(deploy, 'replicas');
    if (typeof rep === 'number') body.push(b('svc_replicas', { N: rep }));
    const res = deploy.resources;
    for (const kind of ['limits', 'reservations']) {
      const r = res?.[kind];
      if (!isPlain(r)) continue;
      if ((r.cpus !== undefined || r.memory !== undefined) && isScalarVal(r.cpus ?? '') && isScalarVal(r.memory ?? '')) {
        body.push(b('svc_resources', { KIND: kind, CPU: str(take(r, 'cpus')), MEM: str(take(r, 'memory')) }));
      }
      if (Array.isArray(r.devices)) {
        r.devices = r.devices.filter((d: any) => {
          const ok = onlyKeys(d, ['driver', 'count', 'capabilities']) && eq(d.capabilities, ['gpu']) && (d.count === undefined || isScalarVal(d.count)) && (d.driver === undefined || typeof d.driver === 'string');
          if (ok) body.push(b('svc_gpu', { DRIVER: str(d.driver), COUNT: str(d.count) }));
          return !ok;
        });
        if (!r.devices.length) delete r.devices;
      }
    }
    const rp = deploy.restart_policy;
    if (onlyKeys(rp, ['condition', 'delay', 'max_attempts']) && ddOk('svc_restart_policy', 'COND', rp.condition) && (rp.max_attempts === undefined || typeof rp.max_attempts === 'number')) {
      delete deploy.restart_policy;
      body.push(b('svc_restart_policy', { COND: rp.condition, MAX: str(rp.max_attempts), DELAY: str(rp.delay) }));
    }
    tail.push(...leftovers(deploy, 'deploy'));
  }
  const mem = s.mem_limit;
  const cpus = s.cpus;
  const pids = s.pids_limit;
  if ([mem, cpus, pids].some((x) => x !== undefined) && [mem, cpus, pids].every((x) => x === undefined || typeof x === 'string' || typeof x === 'number')) {
    for (const k of ['mem_limit', 'cpus', 'pids_limit']) delete s[k];
    body.push(b('svc_limits', { MEM: str(mem), CPUS: str(cpus), PIDS: str(pids) }));
  }
  for (const key of ['cap_drop', 'cap_add']) {
    const caps = take(s, key);
    if (caps === undefined) continue;
    for (const c of Array.isArray(caps) ? caps : [caps]) body.push(b('svc_cap', { MODE: key, CAP: str(c) }));
  }
  const secOpt = take(s, 'security_opt');
  if (secOpt !== undefined) for (const o of Array.isArray(secOpt) ? secOpt : [secOpt]) body.push(b('svc_security_opt', { OPT: str(o) }));
  for (const k of SVC_OPTIONS) {
    const v = take(s, k);
    if (v === undefined) continue;
    if (typeof v === 'string') body.push(b('svc_option', { K: k, V: v }));
    else tail.push(field(k, v));
  }
  for (const k of SVC_FLAGS) {
    const v = take(s, k);
    if (v === true) body.push(b('svc_flag', { K: k }));
    else if (v !== undefined) tail.push(field(k, v));
  }
  const eh = take(s, 'extra_hosts');
  if (Array.isArray(eh))
    for (const h of eh) {
      const t = String(h);
      const i = t.search(/[:=]/);
      body.push(b('svc_extra_host', { H: t.slice(0, i), IP: t.slice(i + 1) }));
    }
  else if (isPlain(eh))
    for (const [h, ip] of Object.entries(eh)) {
      if (typeof ip === 'string' && !ip.includes(':')) body.push(b('svc_extra_host', { H: h, IP: ip }));
      else tail.push(b('x_yaml', { Y: JSON.stringify({ extra_hosts: { [h]: ip } }) }));
    }
  else if (eh !== undefined) tail.push(field('extra_hosts', eh));
  for (const [key, type] of [
    ['secrets', 'svc_secret'],
    ['configs', 'svc_config'],
  ] as const)
    for (const sec of take(s, key) ?? []) {
      if (typeof sec === 'string') body.push(b(type, { NAME: sec, TARGET: '', MODE: '' }));
      else if (onlyKeys(sec, ['source', 'target', 'mode']) && typeof sec.source === 'string' && (sec.mode === undefined || typeof sec.mode === 'number'))
        body.push(b(type, { NAME: sec.source, TARGET: str(sec.target), MODE: octText(sec.mode) }));
      else body.push(listItem(key, sec));
    }
  const ul = take(s, 'ulimits');
  if (isPlain(ul))
    for (const [k, v] of Object.entries(ul)) {
      const u = v as any;
      if (typeof u === 'number' || (typeof u === 'string' && /^\d+$/.test(u))) body.push(b('svc_ulimit', { NAME: k, SOFT: str(u), HARD: '' }));
      else if (onlyKeys(u, ['soft', 'hard']) && u.soft !== undefined && u.hard !== undefined && isScalarVal(u.soft) && isScalarVal(u.hard))
        body.push(b('svc_ulimit', { NAME: k, SOFT: str(u.soft), HARD: str(u.hard) }));
      else tail.push(b('x_yaml', { Y: JSON.stringify({ ulimits: { [k]: v } }) }));
    }
  else if (ul !== undefined) tail.push(field('ulimits', ul));
  const sysctls = take(s, 'sysctls');
  for (const [k, v] of kvList(sysctls)) body.push(b('svc_sysctl', { K: k, V: str(v) }));
  for (const [key, type, f] of [
    ['devices', 'svc_device', 'DEV'],
    ['dns', 'svc_dns', 'IP'],
  ] as const) {
    const v = take(s, key);
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) typeof x === 'string' ? body.push(b(type, { [f]: x })) : body.push(listItem(key, x));
  }
  const tmpfs = take(s, 'tmpfs');
  for (const t of tmpfs === undefined ? [] : Array.isArray(tmpfs) ? tmpfs : [tmpfs]) {
    if (typeof t === 'string') body.push(b('svc_tmpfs', { PATH: t, SIZE: '' }));
    else body.push(listItem('tmpfs', t));
  }
  const ext = take(s, 'extends');
  if (onlyKeys(ext, ['file', 'service']) && typeof ext.service === 'string') body.push(b('svc_extends', { SVC: ext.service, FILE: str(ext.file) }));
  else if (typeof ext === 'string') body.push(b('svc_extends', { SVC: ext, FILE: '' }));
  else if (ext !== undefined) tail.push(field('extends', ext));
  const watch = s.develop?.watch;
  if (Array.isArray(watch)) {
    s.develop.watch = watch.filter((w: any) => {
      const ok = onlyKeys(w, ['action', 'path', 'target']) && ddOk('svc_watch', 'ACTION', w.action) && typeof w.path === 'string';
      if (ok) body.push(b('svc_watch', { ACTION: w.action, PATH: w.path, TARGET: str(w.target) }));
      return !ok;
    });
    if (!s.develop.watch.length) delete s.develop.watch;
  }
  const log = take(s, 'logging');
  if (log !== undefined) {
    const o = log?.options;
    if (
      onlyKeys(log, ['driver', 'options']) &&
      ddOk('svc_logging', 'DRV', log.driver) &&
      log.driver !== 'none' &&
      onlyKeys(o, ['max-size', 'max-file']) &&
      o['max-size'] !== undefined &&
      /^\d+$/.test(String(o['max-file'] ?? ''))
    )
      body.push(b('svc_logging', { DRV: log.driver, SIZE: str(o['max-size']), FILES: Number(o['max-file']) }));
    else tail.push(field('logging', log));
  }
  for (const p of take(s, 'profiles') ?? []) body.push(b('svc_profile', { P: str(p) }));

  return b('compose_service', { NAME: name, IMAGE: image }, [...body, ...tail, ...leftovers(s)]);
}

function importComposeDoc(doc: any) {
  const d = { ...doc };
  const body: B[] = [];
  const tail: B[] = [];
  const ver = d.version;
  const hat = b('compose_file', { NAME: str(take(d, 'name')), VERSION: typeof ver === 'string' || typeof ver === 'number' ? (delete d.version, String(ver)) : '' });
  const inc = take(d, 'include');
  for (const i of inc === undefined ? [] : Array.isArray(inc) ? inc : [inc]) {
    if (typeof i === 'string') body.push(b('compose_include', { PATH: i }));
    else tail.push(listItem('include', i));
  }
  for (const k of Object.keys(d))
    if (k.startsWith('x-') && k.length > 2) body.push(b('compose_extension', { K: k.slice(2), V: YAML.stringify(take(d, k), { lineWidth: 0 }).trimEnd() }));
  for (const [n, svc] of Object.entries(take(d, 'services') ?? {})) body.push(importService(n, svc));
  for (const [n, v] of Object.entries(take(d, 'volumes') ?? {})) {
    const vol = v as any;
    if (
      v === null ||
      (onlyKeys(v, ['driver', 'external', 'name', 'driver_opts']) &&
        (vol.driver === undefined || ddOk('compose_volume', 'DRIVER', vol.driver)) &&
        vol.external !== false &&
        (vol.name === undefined || typeof vol.name === 'string') &&
        (vol.driver_opts === undefined || (isPlain(vol.driver_opts) && Object.values(vol.driver_opts).every((x) => typeof x === 'string' || typeof x === 'number'))))
    ) {
      body.push(b('compose_volume', { NAME: n, DRIVER: vol?.driver ?? '__none__', EXTERNAL: vol?.external === true, XNAME: str(vol?.name) }));
      for (const [k, o] of Object.entries(vol?.driver_opts ?? {})) body.push(b('compose_volume_opt', { VOL: n, K: k, V: str(o) }));
    }
    else tail.push(b('x_yaml', { Y: JSON.stringify({ volumes: { [n]: v } }) }));
  }
  for (const [n, v] of Object.entries(take(d, 'networks') ?? {})) {
    const net = v as any;
    const ipam = net?.ipam;
    const ipamOk = ipam === undefined || (onlyKeys(ipam, ['config']) && Array.isArray(ipam.config) && ipam.config.every((c: any) => onlyKeys(c, ['subnet', 'gateway']) && typeof c.subnet === 'string'));
    if (v === null || (onlyKeys(v, ['driver', 'external', 'internal', 'ipam']) && ipamOk && (net.driver === undefined || ddOk('compose_network', 'DRIVER', net.driver)) && net.external !== false && net.internal !== false)) {
      body.push(b('compose_network', { NAME: n, DRIVER: net?.driver ?? '__none__', EXTERNAL: net?.external === true, INTERNAL: net?.internal === true }));
      for (const c of ipam?.config ?? []) body.push(b('compose_network_subnet', { NET: n, SUBNET: c.subnet, GW: str(c.gateway) }));
    }
    else tail.push(b('x_yaml', { Y: JSON.stringify({ networks: { [n]: v } }) }));
  }
  for (const [n, v] of Object.entries(take(d, 'secrets') ?? {})) {
    const sv = v as any;
    if (eq(sv, { external: true })) body.push(b('compose_secret', { NAME: n, SRC: 'external', FILE: '' }));
    else if (onlyKeys(sv, ['file']) || onlyKeys(sv, ['environment'])) {
      const src = Object.keys(sv)[0];
      if (Object.keys(sv).length === 1 && typeof sv[src] === 'string') body.push(b('compose_secret', { NAME: n, SRC: src, FILE: sv[src] }));
      else tail.push(b('x_yaml', { Y: JSON.stringify({ secrets: { [n]: v } }) }));
    } else tail.push(b('x_yaml', { Y: JSON.stringify({ secrets: { [n]: v } }) }));
  }
  for (const [n, v] of Object.entries(take(d, 'configs') ?? {})) {
    const cv = v as any;
    const src = isPlain(cv) && Object.keys(cv).length === 1 ? Object.keys(cv)[0] : '';
    if (eq(cv, { external: true })) body.push(b('compose_config', { NAME: n, SRC: 'external', VAL: '' }));
    else if (['file', 'content', 'environment'].includes(src) && typeof cv[src] === 'string') body.push(b('compose_config', { NAME: n, SRC: src, VAL: cv[src] }));
    else tail.push(b('x_yaml', { Y: JSON.stringify({ configs: { [n]: v } }) }));
  }
  tail.push(...leftovers(d));
  return { hat, children: [...body, ...tail] };
}

function importTemplate(doc: any, notes: Set<string>): { hat: B; children: B[]; objects: any[] } {
  stripClusterFields(doc, notes);
  take(doc, 'kind');
  take(doc, 'apiVersion');
  const meta = take(doc, 'metadata') ?? {};
  const name = str(take(meta, 'name')) || 'template';
  const desc = isPlain(meta.annotations) && typeof meta.annotations.description === 'string' ? take(meta.annotations, 'description') : '';
  const body: B[] = [];
  const tail: B[] = [];
  metaBlocks(meta, body, tail);
  for (const p of take(doc, 'parameters') ?? []) {
    const ok =
      onlyKeys(p, ['name', 'value', 'required', 'description', 'generate', 'from']) &&
      typeof p.name === 'string' &&
      (p.value === undefined || isScalarVal(p.value)) &&
      [undefined, true, false].includes(p.required) &&
      (p.generate === undefined ? p.from === undefined : p.generate === 'expression' && typeof p.from === 'string');
    if (ok) body.push(b('tpl_param', { NAME: p.name, VALUE: str(p.value), REQ: p.required === true, FROM: str(p.from), DESC: str(p.description) }));
    else body.push(listItem('parameters', p));
  }
  const objects = take(doc, 'objects') ?? [];
  tail.push(...leftovers(doc));
  return { hat: b('k8s_template', { NAME: name, DESC: desc }), children: [...body, ...tail], objects: Array.isArray(objects) ? objects.filter(isPlain) : [] };
}

// =====================================================================
// entry
// =====================================================================
export function isComposeDoc(d: any) {
  return isPlain(d) && !d.apiVersion && !d.kind && (isPlain(d.services) || d.version !== undefined || d.include !== undefined);
}

export function importYaml(text: string, fileName = 'import.yaml'): ImportResult {
  const docs = parseYamlDocs(text);
  if (!docs.length) throw new Error('Datei enthält kein YAML-Dokument');
  if (!docs.every(isPlain)) throw new Error('Jedes YAML-Dokument muss ein Objekt (Map) sein');

  const compose = docs.some(isComposeDoc);
  const kind: FileKind = compose ? 'compose' : 'k8s';
  const stripped = new Set<string>();
  const isTemplate = (d: any) => d.kind === 'Template' && /^(template\.openshift\.io\/)?v1$/.test(str(d.apiVersion));
  const results = docs.flatMap((d) => {
    if (compose) return [importComposeDoc(d)];
    if (!isTemplate(d)) return [importK8sDoc(structuredClone(d), stripped)];
    const t = importTemplate(structuredClone(d), stripped);
    return [t, ...t.objects.map((o) => importK8sDoc(o, stripped))];
  });
  const stacks = results.map((r, i) => stack(r.hat, r.children, 40, 40 + i * 600));

  const notes: string[] = [];
  const extras = JSON.stringify(stacks).match(/"type":"x_(field|list|yaml)"/g)?.length ?? 0;
  notes.push(`${docs.length} Dokument${docs.length === 1 ? '' : 'e'} als ${compose ? 'Docker Compose' : 'Kubernetes/OpenShift'} importiert.`);
  if (extras) notes.push(`${extras} Feld${extras === 1 ? '' : 'er'} ohne eigenen Block als Extras übernommen.`);
  if (stripped.size) notes.push(`Cluster-Felder entfernt: ${[...stripped].join(', ')}.`);

  const name = /\.ya?ml$/i.test(fileName) ? fileName : `${fileName.replace(/\.[^.]*$/, '')}.yaml`;
  return { file: { id: uid(), name, kind, state: wsState(...stacks), needsLayout: stacks.length > 1 }, notes };
}
