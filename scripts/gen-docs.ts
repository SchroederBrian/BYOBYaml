// Generates the block + snippet reference for the docs site straight from the app code.
// Every example YAML is produced by the real generator, so the docs never drift.
// Run: bun scripts/gen-docs.ts
import * as Blockly from 'blockly/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_BLOCKS } from '../src/blocks/defs';
import { registerBlocks } from '../src/blocks/register';
import { generate } from '../src/blocks/generator';
import { ArgDef, BlockSpec, CATEGORIES, CatId } from '../src/blocks/types';
import { b, B, chainJson, wsState } from '../src/project';
import { BUILTIN_SNIPPETS } from '../src/snippets';

registerBlocks();
const OUT = join(import.meta.dir, '..', 'docs-site', 'docs', 'referenz');
mkdirSync(OUT, { recursive: true });

const SPEC = Object.fromEntries(ALL_BLOCKS.map((s) => [s.type, s]));

// ---------- context: wrap a block chain so it lands in a valid place ----------
const KIND_HAT: Record<string, B> = {
  Deployment: b('k8s_deployment', { NAME: 'demo', REPLICAS: 1 }),
  StatefulSet: b('k8s_statefulset', { NAME: 'demo', REPLICAS: 1, SVC: 'demo' }),
  Service: b('k8s_service', { NAME: 'demo', APP: 'demo', TYPE: 'ClusterIP' }),
  Route: b('k8s_route', { NAME: 'demo', SVC: 'demo', PORT: 'http' }),
  Ingress: b('k8s_ingress', { NAME: 'demo', CLASS: 'nginx' }),
  ConfigMap: b('k8s_configmap', { NAME: 'demo' }),
  Secret: b('k8s_secret', { NAME: 'demo', TYPE: 'Opaque' }),
  PersistentVolumeClaim: b('k8s_pvc', { NAME: 'demo', SIZE: '1Gi', MODE: 'ReadWriteOnce' }),
  HorizontalPodAutoscaler: b('k8s_hpa', { NAME: 'demo', TARGET: 'demo', MIN: 1, MAX: 3 }),
  ImageStream: b('k8s_imagestream', { NAME: 'demo', LOCAL: false }),
  BuildConfig: b('k8s_buildconfig', { NAME: 'demo', OUT: 'demo:latest', RUN: 'Serial' }),
};

function wrap(blocks: B[]): B[] {
  const first = SPEC[blocks[0].type];
  if (first.shape === 'hat') return blocks;
  const scope = first.scope ?? [];
  if (scope.includes('service')) return [b('compose_file', { NAME: '' }), b('compose_service', { NAME: 'web', IMAGE: 'nginx:latest' }, blocks)];
  if (scope.includes('compose')) return [b('compose_file', { NAME: '' }), ...blocks];
  if (scope.includes('container')) return [KIND_HAT.Deployment, b('pod_container', { NAME: 'app', IMAGE: 'nginx:latest' }, blocks)];
  if (scope.includes('pod')) return [KIND_HAT.Deployment, ...blocks];
  for (const s of scope) if (KIND_HAT[s]) return [KIND_HAT[s], ...blocks];
  if (scope.includes('k8s')) return [KIND_HAT.ConfigMap, ...blocks];
  // Extras: show on a custom resource
  return [b('k8s_custom', { NAME: 'demo', KIND: 'Example', API: 'example.io/v1' }), ...blocks];
}

function yamlOf(blocks: B[]): { yaml: string; warnings: string[] } {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(wsState({ ...chainJson(blocks), x: 0, y: 0 }), ws);
  const r = generate(ws);
  ws.dispose();
  return { yaml: r.yaml, warnings: r.warnings.map((w) => w.msg) };
}

// ---------- text helpers ----------
const esc = (s: string) => s.replace(/[<>{}|]/g, (c) => `&#${c.charCodeAt(0)};`);
const code = (s: string) => '`' + s.replace(/`/g, 'ˋ') + '`';

function defaultOf(a: ArgDef): string {
  switch (a.kind) {
    case 'text':
      return a.value === '' ? '*(leer)*' : code(a.value);
    case 'num':
      return code(String(a.value));
    case 'chk':
      return a.value ? 'an' : 'aus';
    case 'dd':
      return code(a.options[0][0]);
  }
}
const KIND_LABEL: Record<ArgDef['kind'], string> = { text: 'Text', num: 'Zahl', dd: 'Auswahl', chk: 'Häkchen' };

function title(spec: BlockSpec): string {
  return spec.msg.replace(/%(\d+)/g, '…').replace(/\s+/g, ' ').trim();
}
function signature(spec: BlockSpec): string {
  return spec.msg.replace(/%(\d+)/g, (_, n) => `[${n}]`).replace(/\s+/g, ' ').trim();
}

const SHAPE: Record<BlockSpec['shape'], string> = {
  hat: 'Startblock – beginnt ein YAML-Dokument',
  stmt: 'Stapelblock',
  c: 'Klammerblock – nimmt weitere Blöcke auf',
};

function exampleBlocks(spec: BlockSpec): B[] {
  const fields: Record<string, any> = {};
  for (const a of spec.args ?? []) {
    if (a.kind === 'dd') fields[a.name] = a.options[0][1] === '' ? '__none__' : a.options[0][1];
    else fields[a.name] = a.value;
  }
  return [b(spec.type, fields, spec.shape === 'c' ? [] : undefined)];
}

// ---------- category pages ----------
const CAT_INTRO: Record<CatId, string> = {
  compose: 'Grundgerüst einer `docker-compose.yml`: der Startblock, Services sowie projektweite Volumes, Netzwerke und Secrets.',
  service: 'Optionen eines Compose-Services. Diese Blöcke gehören **in** einen `Service`-Klammerblock.',
  resources: 'Startblöcke für Kubernetes- und OpenShift-Ressourcen. Jeder Startblock erzeugt ein YAML-Dokument; mehrere in einer Datei werden mit `---` getrennt.',
  metadata: 'Namespace, Labels und Annotationen einer Ressource. Passen unter jeden Ressourcen-Startblock.',
  pod: 'Einstellungen auf Pod-Ebene. Gehören unter Deployment, StatefulSet, DaemonSet, Job oder CronJob.',
  container: 'Einstellungen eines Containers. Gehören **in** einen `Container`- oder `Init-Container`-Klammerblock.',
  network: 'Ports eines Services, Route- und Ingress-Regeln.',
  data: 'Inhalte von ConfigMaps und Secrets, Speicher-Optionen für PVCs und StatefulSets.',
  build: 'OpenShift-Builds: ImageStream-Tags und BuildConfig-Quellen, -Strategien und -Trigger.',
  scaling: 'Metriken und Verhalten des HorizontalPodAutoscalers.',
  extras: 'Notausgänge für alles ohne eigenen Block. Sie wirken auf das **aktuelle Objekt**: unter einem Startblock die Ressource, in einem Service den Service, in einem Container den Container.',
};

const SLUG: Record<CatId, string> = {
  compose: 'compose',
  service: 'service',
  resources: 'ressourcen',
  metadata: 'metadaten',
  pod: 'pod',
  container: 'container',
  network: 'netzwerk',
  data: 'daten',
  build: 'build',
  scaling: 'skalierung',
  extras: 'extras',
};

let pos = 1;
for (const cat of CATEGORIES) {
  const specs = ALL_BLOCKS.filter((s) => s.cat === cat.id);
  const out: string[] = [
    '---',
    `title: ${JSON.stringify(cat.name)}`,
    `sidebar_label: ${JSON.stringify(cat.name)}`,
    `sidebar_position: ${pos++}`,
    `description: ${JSON.stringify(CAT_INTRO[cat.id].replace(/[`*]/g, '').split('.')[0] + '.')}`,
    '---',
    '',
    '{/* Automatisch erzeugt von scripts/gen-docs.ts – nicht von Hand bearbeiten. */}',
    '',
    `# <span className="cat-dot" style={{ background: '${cat.colour}' }} /> ${cat.name}`,
    '',
    CAT_INTRO[cat.id],
    '',
    `| Block | Art | Platz |`,
    `| --- | --- | --- |`,
    ...specs.map((s) => `| [${esc(title(s))}](#${s.type.replace(/_/g, '-')}) | ${s.shape === 'hat' ? 'Start' : s.shape === 'c' ? 'Klammer' : 'Stapel'} | ${esc(s.where ?? (s.shape === 'hat' ? 'oberste Ebene' : 'überall'))} |`),
    '',
  ];
  for (const s of specs) {
    out.push(`## ${esc(title(s))} {#${s.type.replace(/_/g, '-')}}`, '');
    out.push(`<div className="block-sig" style={{ '--c': '${cat.colour}' }}>${esc(signature(s))}</div>`, '');
    out.push(`**${SHAPE[s.shape]}** · Typ-ID ${code(s.type)}${s.where ? ` · gehört ${esc(s.where)}` : ''}`, '');
    if (s.tip) out.push(`> ${esc(s.tip)}`, '');
    if (s.args?.length) {
      out.push('| # | Feld | Art | Standard | Auswahl |', '| --- | --- | --- | --- | --- |');
      s.args.forEach((a, i) => {
        const opts = a.kind === 'dd' ? a.options.map(([l, v]) => (l === v || v === '' ? code(l) : `${code(l)} → ${code(v)}`)).join(', ') : '';
        out.push(`| ${i + 1} | ${code(a.name)} | ${KIND_LABEL[a.kind]} | ${defaultOf(a)} | ${opts} |`);
      });
      out.push('');
    }
    const { yaml } = yamlOf(wrap(exampleBlocks(s)));
    out.push('<details>', '<summary>Erzeugtes YAML mit Standardwerten</summary>', '', '```yaml', yaml.trimEnd() || '# (kein Output – reiner Notiz-Block)', '```', '', '</details>', '');
  }
  writeFileSync(join(OUT, `${SLUG[cat.id]}.mdx`), out.join('\n'));
}

writeFileSync(
  join(OUT, '_category_.json'),
  JSON.stringify({ label: 'Block-Referenz', position: 6, link: { type: 'generated-index', description: `Alle ${ALL_BLOCKS.length} Blöcke mit Feldern, Standardwerten und dem YAML, das sie erzeugen.` } }, null, 2),
);

// ---------- snippets page ----------
const snip: string[] = [
  '---',
  'title: Mitgelieferte Vorlagen',
  'sidebar_label: Vorlagen-Katalog',
  'sidebar_position: 2',
  '---',
  '',
  '{/* Automatisch erzeugt von scripts/gen-docs.ts – nicht von Hand bearbeiten. */}',
  '',
  '# Mitgelieferte Vorlagen',
  '',
  `BYOBYaml bringt ${BUILTIN_SNIPPETS.length} Vorlagen mit. Du findest sie im Editor unter **Vorlagen** in der Palette. Zieh eine Vorlage auf die Fläche oder direkt an die passende Stelle in einem Stapel.`,
  '',
];
for (const kind of ['compose', 'k8s'] as const) {
  snip.push(`## ${kind === 'compose' ? 'Docker Compose' : 'Kubernetes & OpenShift'}`, '');
  const groups = [...new Set(BUILTIN_SNIPPETS.filter((s) => s.kind === kind).map((s) => s.group))];
  for (const g of groups) {
    snip.push(`### ${g}`, '');
    for (const s of BUILTIN_SNIPPETS.filter((x) => x.kind === kind && x.group === g)) {
      const list = (bs: B[], depth = 0): string[] =>
        bs.flatMap((x) => [`${'  '.repeat(depth)}- ${code(fill(x))}`, ...(x.body ? list(x.body, depth + 1) : [])]);
      snip.push(`#### ${esc(s.name)}`, '', esc(s.hint), '', ...list(s.blocks), '');
      const { yaml } = yamlOf(wrap(s.blocks));
      snip.push('<details>', '<summary>Erzeugtes YAML</summary>', '', '```yaml', yaml.trimEnd(), '```', '', '</details>', '');
    }
  }
}
writeFileSync(join(OUT, '..', 'vorlagen', 'katalog.mdx'), snip.join('\n'));

function fill(x: B): string {
  const spec = SPEC[x.type];
  let i = 0;
  return spec.msg
    .replace(/%\d+/g, () => {
      const a = spec.args![i++];
      const v = x.fields?.[a.name];
      if (a.kind === 'dd') return a.options.find(([, val]) => val === v || (val === '' && v === '__none__'))?.[0] ?? String(v);
      if (a.kind === 'chk') return v ? '☑' : '☐';
      return String(v ?? '');
    })
    .replace(/\s+/g, ' ');
}

// ---------- Handbuch: worked examples (blocks → exact YAML) ----------
const CAT_COLOUR = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.colour]));

function tree(bs: B[], depth = 0): string[] {
  return bs.flatMap((x) => [
    `<div className="blk-row" style={{ marginLeft: '${depth * 1.6}rem' }}><span className="blk${SPEC[x.type].shape === 'hat' ? ' blk-hat' : ''}" style={{ '--c': '${CAT_COLOUR[SPEC[x.type].cat]}' }}>${esc(fill(x))}</span></div>`,
    ...(x.body ? tree(x.body, depth + 1) : []),
  ]);
}

function yamlOfStacks(stacks: B[][], vars: Record<string, string> = {}): string {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(wsState(...stacks.map((s, i) => ({ ...chainJson(s), x: 0, y: i * 1000 }))), ws);
  const r = generate(ws, vars);
  ws.dispose();
  return r.yaml;
}

interface Example {
  id: string;
  title: string;
  kind: 'Compose' | 'Kubernetes' | 'OpenShift';
  intro: string;
  steps: string[];
  stacks: B[][];
  vars?: Record<string, string>;
  notes?: string[];
}

const EXAMPLES: Example[] = [
  {
    id: 'compose-webserver',
    title: 'Statischer Webserver',
    kind: 'Compose',
    intro: 'Ein nginx, der einen lokalen Ordner read-only ausliefert und nach einem Absturz neu startet.',
    steps: [
      'Compose-Datei anlegen; der Startblock *Docker Compose · Projekt* ist schon da.',
      '**Compose → Service** unter den Startblock ziehen, Name `web`, Image `nginx:1.27-alpine`.',
      '**Service → Port** in den Service legen: Host `8080`, Container `80`.',
      '**Service → Volume** in den Service legen: `./html` → `/usr/share/nginx/html`, Häkchen *nur lesen*.',
      '**Service → Neustart** `unless-stopped`.',
    ],
    stacks: [
      [
        b('compose_file', { NAME: 'website' }),
        b('compose_service', { NAME: 'web', IMAGE: 'nginx:1.27-alpine' }, [
          b('svc_port', { HOST: '8080', CONT: '80', PROTO: 'tcp' }),
          b('svc_volume', { SRC: './html', DST: '/usr/share/nginx/html', RO: true }),
          b('svc_restart', { R: 'unless-stopped' }),
        ]),
      ],
    ],
    notes: ['Ports schreibt BYOBYaml immer in Anführungszeichen (`"8080:80"`). Sonst kann YAML 1.1 Werte wie `22:22` als Zahl im 60er-System lesen.'],
  },
  {
    id: 'compose-app-db',
    title: 'App wartet auf gesunde Datenbank',
    kind: 'Compose',
    intro: 'Die App startet erst, wenn PostgreSQL seinen Healthcheck besteht. Die Daten liegen in einem benannten Volume.',
    steps: [
      'Service `db` mit Image `postgres:16-alpine`, drei *Variable*-Blöcke für User, Passwort und Datenbank.',
      '*Volume* `pgdata` → `/var/lib/postgresql/data` und *Healthcheck* `pg_isready -U app`.',
      'Service `app` mit leerem Image, dafür *Build Ordner* `.`.',
      'Im Service `app`: *wartet auf* `db` bis **gesund**.',
      'Ganz unten unter dem Startblock: **Compose → Volume** `pgdata`. Benannte Volumes müssen auf oberster Ebene deklariert werden.',
    ],
    stacks: [
      [
        b('compose_file', { NAME: 'shop' }),
        b('compose_service', { NAME: 'db', IMAGE: 'postgres:16-alpine' }, [
          b('svc_env', { K: 'POSTGRES_USER', V: 'app' }),
          b('svc_env', { K: 'POSTGRES_PASSWORD', V: 'change-me' }),
          b('svc_env', { K: 'POSTGRES_DB', V: 'app' }),
          b('svc_volume', { SRC: 'pgdata', DST: '/var/lib/postgresql/data', RO: false }),
          b('svc_healthcheck', { CMD: 'pg_isready -U app', INT: '10s', TO: '5s', RET: 5 }),
        ]),
        b('compose_service', { NAME: 'app', IMAGE: '' }, [
          b('svc_build', { CTX: '.', FILE: 'Dockerfile' }),
          b('svc_port', { HOST: '3000', CONT: '3000', PROTO: 'tcp' }),
          b('svc_env', { K: 'DATABASE_URL', V: 'postgres://app:change-me@db:5432/app' }),
          b('svc_depends', { NAME: 'db', COND: 'service_healthy' }),
        ]),
        b('compose_volume', { NAME: 'pgdata', DRIVER: '__none__' }),
      ],
    ],
  },
  {
    id: 'compose-variablen',
    title: 'Image-Tag und Port als Variablen',
    kind: 'Compose',
    intro: 'Derselbe Service mit unterschiedlichen Werten je Umgebung. Die Tabelle zeigt die Variablen, das YAML entsteht mit der Umgebung `prod`.',
    steps: ['Im Tab **Variablen** die Variablen `TAG` und `PORT` anlegen.', 'In den Blöcken `${TAG}` und `${PORT}` in die Felder schreiben.', 'Oben rechts die Umgebung `prod` wählen.'],
    stacks: [
      [
        b('compose_file', { NAME: '' }),
        b('compose_service', { NAME: 'api', IMAGE: 'registry.example.com/api:${TAG}' }, [
          b('svc_port', { HOST: '${PORT}', CONT: '8080', PROTO: 'tcp' }),
          b('svc_env', { K: 'RELEASE', V: 'api-${TAG}' }),
        ]),
      ],
    ],
    vars: { TAG: '1.4.2', PORT: '80' },
    notes: ['| Variable | dev | prod |\n| --- | --- | --- |\n| `TAG` | `latest` | `1.4.2` |\n| `PORT` | `8080` | `80` |'],
  },
  {
    id: 'k8s-config-secret',
    title: 'ConfigMap und Secret in einen Container',
    kind: 'Kubernetes',
    intro: 'Drei Dokumente in einer Datei: ConfigMap, Secret und ein Deployment, das alles als Umgebungsvariablen bekommt.',
    steps: [
      '**Ressourcen → ConfigMap** auf die Fläche ziehen, darunter zwei **Config & Daten → Eintrag**-Blöcke.',
      '**Ressourcen → Secret** daneben ziehen, darunter ein Eintrag `DB_PASSWORD`.',
      'Deployment mit Container. Im Container: *alle Variablen aus ConfigMap* und *Variable … aus Secret … Schlüssel …* für einen einzelnen Wert.',
    ],
    stacks: [
      [b('k8s_configmap', { NAME: 'app-config' }), b('data_entry', { K: 'LOG_LEVEL', V: 'info' }), b('data_entry', { K: 'FEATURE_X', V: 'true' })],
      [b('k8s_secret', { NAME: 'app-secret', TYPE: 'Opaque' }), b('data_entry', { K: 'DB_PASSWORD', V: 'change-me' })],
      [
        b('k8s_deployment', { NAME: 'app', REPLICAS: 1 }),
        b('pod_container', { NAME: 'app', IMAGE: 'registry.example.com/app:1.0' }, [
          b('c_env_from', { SRC: 'configMapRef', NAME: 'app-config' }),
          b('c_env_ref', { K: 'DB_PASSWORD', SRC: 'secretKeyRef', NAME: 'app-secret', KEY: 'DB_PASSWORD' }),
        ]),
      ],
    ],
    notes: ['`stringData` nimmt Klartext an; Kubernetes speichert ihn base64-kodiert. Das ist **keine Verschlüsselung**.'],
  },
  {
    id: 'k8s-pvc',
    title: 'Persistenter Speicher',
    kind: 'Kubernetes',
    intro: 'Ein PVC wird als Volume im Pod definiert und im Container eingehängt. Der Name `data` verbindet beides.',
    steps: [
      '**Ressourcen → Speicher (PVC)** `app-data`, `5Gi`, `ReadWriteOnce`.',
      'Im Deployment: **Pod → Volume aus PVC** mit Name `data` und Claim `app-data`.',
      'Im Container: **Container → Volume einhängen** mit Name `data` und Pfad `/var/lib/app`.',
    ],
    stacks: [
      [b('k8s_pvc', { NAME: 'app-data', SIZE: '5Gi', MODE: 'ReadWriteOnce' })],
      [
        b('k8s_deployment', { NAME: 'app', REPLICAS: 1 }),
        b('pod_vol_pvc', { NAME: 'data', CLAIM: 'app-data' }),
        b('pod_container', { NAME: 'app', IMAGE: 'registry.example.com/app:1.0' }, [b('c_mount', { NAME: 'data', PATH: '/var/lib/app', RO: false })]),
      ],
    ],
    notes: ['Bei `ReadWriteOnce` kann nur ein Node das Volume einhängen. Für mehrere Replicas auf verschiedenen Nodes brauchst du `ReadWriteMany` oder ein StatefulSet mit *pro Pod Speicher*.'],
  },
  {
    id: 'k8s-ingress',
    title: 'Ingress mit TLS und zwei Pfaden',
    kind: 'Kubernetes',
    intro: 'Ein Hostname, zwei Backends: `/` geht ans Frontend, `/api` an die API. Das Zertifikat stellt cert-manager aus.',
    steps: [
      '**Ressourcen → Ingress** mit Klasse `nginx`.',
      '**Netzwerk → cert-manager Issuer** `letsencrypt` und **TLS für** Host plus Secret-Name.',
      'Zwei **Regel**-Blöcke mit demselben Host. BYOBYaml fasst sie unter einem `host` zusammen.',
    ],
    stacks: [
      [
        b('k8s_ingress', { NAME: 'shop', CLASS: 'nginx' }),
        b('ingress_annotation_ssl', { ISSUER: 'letsencrypt' }),
        b('ingress_tls', { HOST: 'shop.example.com', SECRET: 'shop-tls' }),
        b('ingress_rule', { HOST: 'shop.example.com', PATH: '/', SVC: 'frontend', PORT: '80' }),
        b('ingress_rule', { HOST: 'shop.example.com', PATH: '/api', SVC: 'api', PORT: 'http' }),
      ],
    ],
    notes: ['Steht im Port-Feld eine Zahl, wird daraus `port.number`. Steht dort ein Name wie `http`, wird daraus `port.name`.'],
  },
  {
    id: 'openshift-route',
    title: 'Route mit eigenem Hostnamen',
    kind: 'OpenShift',
    intro: 'Eine HTTPS-Route mit Edge-Termination: HTTP wird auf HTTPS umgeleitet.',
    steps: ['**Ressourcen → Route** mit Service `web` und Port `http` (Name des Service-Ports).', '**Netzwerk → Hostname** und **HTTPS** `edge` mit *umleiten*.'],
    stacks: [[b('k8s_route', { NAME: 'web', SVC: 'web', PORT: 'http' }), b('route_host', { HOST: 'web.apps.example.com' }), b('route_tls', { TERM: 'edge', INSEC: 'Redirect' })]],
  },
  {
    id: 'k8s-cronjob',
    title: 'Nächtlicher CronJob',
    kind: 'Kubernetes',
    intro: 'Ein Backup um 02:00 Uhr. Läuft noch ein alter Job, startet kein neuer; dafür sorgt ein Extras-Feld.',
    steps: [
      '**Ressourcen → CronJob** mit Zeitplan `0 2 * * *`.',
      '**Extras → Feld** `spec.concurrencyPolicy` = `Forbid`. Diese Option hat keinen eigenen Block.',
      'Container mit *Command*. Anführungszeichen halten Argumente zusammen.',
    ],
    stacks: [
      [
        b('k8s_cronjob', { NAME: 'backup', SCHEDULE: '0 2 * * *' }),
        b('x_field', { PATH: 'spec.concurrencyPolicy', VAL: 'Forbid' }),
        b('pod_container', { NAME: 'backup', IMAGE: 'alpine:3.20' }, [b('c_command', { CMD: '/bin/sh -c "tar czf /backup/data.tgz /data"' })]),
      ],
    ],
  },
  {
    id: 'k8s-extras',
    title: 'Extras: Felder ohne eigenen Block',
    kind: 'Kubernetes',
    intro: 'Tolerations, ein Lifecycle-Hook und ein abweichendes Feld. Alles mit den drei Extras-Blöcken.',
    steps: [
      '*zu Liste … hinzufügen* direkt unter dem Deployment: Der Pfad beginnt bei der Ressource (`spec.template.spec.tolerations`).',
      '*Feld* **im** Container: Der Pfad beginnt beim Container (`lifecycle.preStop`).',
      '*YAML einmischen* für Schlüssel mit Punkten (Annotation).',
    ],
    stacks: [
      [
        b('k8s_deployment', { NAME: 'worker', REPLICAS: 2 }),
        b('x_list', { PATH: 'spec.template.spec.tolerations', VAL: '{key: dedicated, operator: Equal, value: batch, effect: NoSchedule}' }),
        b('x_yaml', { Y: '{metadata: {annotations: {app.openshift.io/connects-to: db}}}' }),
        b('pod_container', { NAME: 'worker', IMAGE: 'registry.example.com/worker:2.0' }, [b('x_field', { PATH: 'lifecycle.preStop.exec.command', VAL: '[sh, -c, sleep 5]' })]),
      ],
    ],
  },
  {
    id: 'eigene-ressource',
    title: 'Eigene Ressource: PodDisruptionBudget',
    kind: 'Kubernetes',
    intro: 'Für Ressourcen ohne eigenen Startblock. Hier sorgt ein PDB dafür, dass bei Node-Wartungen immer ein Pod läuft.',
    steps: ['**Ressourcen → Eigene Ressource**: kind `PodDisruptionBudget`, apiVersion `policy/v1`.', 'Inhalt mit *Feld*-Blöcken.'],
    stacks: [
      [
        b('k8s_custom', { NAME: 'web-pdb', KIND: 'PodDisruptionBudget', API: 'policy/v1' }),
        b('x_field', { PATH: 'spec.minAvailable', VAL: '1' }),
        b('x_field', { PATH: 'spec.selector.matchLabels', VAL: '{app: web}' }),
      ],
    ],
  },
  {
    id: 'k8s-hpa',
    title: 'Autoscaling nach CPU und RAM',
    kind: 'Kubernetes',
    intro: 'Zwischen 2 und 10 Pods; das Herunterskalieren beginnt erst nach 5 Minuten ohne Last.',
    steps: ['**Ressourcen → Autoscaler** für Deployment `web`, min `2`, max `10`.', 'Zwei **Skalierung → Ziel**-Blöcke und ein **herunterskalieren erst nach**.'],
    stacks: [
      [
        b('k8s_hpa', { NAME: 'web', TARGET: 'web', MIN: 2, MAX: 10 }),
        b('hpa_metric', { RES: 'cpu', PCT: 70 }),
        b('hpa_metric', { RES: 'memory', PCT: 80 }),
        b('hpa_behavior', { S: 300 }),
      ],
    ],
    notes: ['Auslastung bezieht sich auf die **requests** der Container. Ohne `resources.requests` kann der HPA nicht rechnen.'],
  },
];

const ex: string[] = [
  '---',
  'title: Beispiele zum Nachbauen',
  'sidebar_label: 9 · Beispiele',
  'sidebar_position: 9',
  '---',
  '',
  '{/* Automatisch erzeugt von scripts/gen-docs.ts – nicht von Hand bearbeiten. */}',
  '',
  '# Beispiele zum Nachbauen',
  '',
  'Jedes Beispiel zeigt die **Blöcke**, die **Schritte** und das **exakte YAML**, das BYOBYaml daraus erzeugt. Das YAML stammt direkt aus dem Generator der App.',
  '',
  '| Beispiel | Art |',
  '| --- | --- |',
  ...EXAMPLES.map((e) => `| [${esc(e.title)}](#${e.id}) | ${e.kind} |`),
  '',
];
for (const e of EXAMPLES) {
  ex.push(`## ${esc(e.title)} {#${e.id}}`, '', `<span className="kind-tag">${e.kind}</span> ${esc(e.intro)}`, '');
  ex.push('**So baust du es:**', '', ...e.steps.map((s, i) => `${i + 1}. ${s}`), '');
  ex.push('**Blöcke:**', '', '<div className="blk-tree">', ...e.stacks.flatMap((s, i) => [...(i ? ['<div className="blk-gap" />'] : []), ...tree(s)]), '</div>', '');
  ex.push(`**Ergebnis${e.vars ? ' (Umgebung prod)' : ''}:**`, '', '```yaml', yamlOfStacks(e.stacks, e.vars).trimEnd(), '```', '');
  for (const n of e.notes ?? []) ex.push(n.startsWith('|') ? n : `:::tip\n${n}\n:::`, '');
}
writeFileSync(join(OUT, '..', 'handbuch', 'beispiele.mdx'), ex.join('\n'));

console.log(`Referenz: ${ALL_BLOCKS.length} Blöcke in ${CATEGORIES.length} Seiten, ${BUILTIN_SNIPPETS.length} Vorlagen, ${EXAMPLES.length} Beispiele.`);
