import { parseAllDocuments } from 'yaml';
import type { ProjectFile } from './project';

export interface DependencyNode {
  id: string;
  name: string;
  kind: string;
  category: 'file' | 'service' | 'workload' | 'resource' | 'chart' | 'value';
  fileId?: string;
  filePath?: string;
  namespace?: string;
  external?: boolean;
  cycle?: boolean;
}
export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: 'contains' | 'reference' | 'dependency' | 'file';
  cycle?: boolean;
}
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  issues: { fileId: string; message: string }[];
}

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const nameOf = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const names = (value: unknown): string[] => Array.isArray(value) ? value.map(nameOf).filter(Boolean) : Object.keys(record(value));
const workloadKinds = new Set(['Pod', 'Deployment', 'DeploymentConfig', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController', 'Job', 'CronJob']);
const clusterKinds = new Set(['Namespace', 'Node', 'PersistentVolume', 'StorageClass', 'ClusterRole', 'ClusterRoleBinding', 'CustomResourceDefinition', 'SecurityContextConstraints', 'PriorityClass']);
const filePath = (file: ProjectFile) => file.folder ? `${file.folder}/${file.name}` : file.name;
const fileNodeId = (id: string) => `file:${id}`;
const composeKey = (fileId: string, kind: string, name: string) => JSON.stringify(['compose', fileId, kind, name]);
const kubeKey = (kind: string, namespace: string, name: string) => JSON.stringify(['kube', kind, clusterKinds.has(kind) ? '' : namespace, name]);

/** Project-only static analysis. No network access, environment values or secret decryption. */
export function buildDependencyGraph(files: ProjectFile[], getYaml: (file: ProjectFile) => string): DependencyGraph {
  const graph: DependencyGraph = { nodes: [], edges: [], issues: [] };
  const nodes = new Map<string, DependencyNode>();
  const identities = new Map<string, DependencyNode[]>();
  const edges = new Map<string, DependencyEdge>();
  const paths = new Map<string, ProjectFile[]>();
  const work: { node: DependencyNode; doc: RecordValue; file: ProjectFile; compose: boolean }[] = [];
  const addNode = (node: DependencyNode, identity?: string) => {
    nodes.set(node.id, node);
    if (identity) identities.set(identity, [...(identities.get(identity) ?? []), node]);
    return node;
  };
  const edge = (source: string, target: string, label: string, type: DependencyEdge['type'] = 'reference') => {
    const id = JSON.stringify([source, target, label, type]);
    edges.set(id, { id, source, target, label, type });
  };
  const link = (source: DependencyNode, identity: string, fallback: Omit<DependencyNode, 'id'>, label: string, type: DependencyEdge['type'] = 'reference') => {
    const matches = /\$\{|\[Secret:/.test(fallback.name) ? [] : identities.get(identity) ?? [];
    if (matches.length > 1) graph.issues.push({ fileId: source.fileId!, message: `${fallback.kind} „${fallback.name}“ ist mehrfach definiert; der Verweis ist nicht eindeutig.` });
    const targets = matches.length ? matches : [nodes.get(`external:${identity}`) ?? addNode({ ...fallback, id: `external:${identity}`, external: true })];
    for (const target of targets) edge(source.id, target.id, label, type);
  };
  const relativePath = (file: ProjectFile, raw: string) => {
    const parts: string[] = [];
    const path = raw.replace(/\\/g, '/');
    if (/^(?:[A-Za-z]+:|\/|~)/.test(path)) return path;
    for (const part of `${file.folder ?? ''}/${path}`.split('/')) {
      if (part === '..') { if (!parts.length) return path; parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const fileReference = (source: DependencyNode, file: ProjectFile, raw: unknown, label: string) => {
    const name = nameOf(raw);
    if (!name) return [] as ProjectFile[];
    const path = relativePath(file, name);
    const targets = paths.get(path) ?? [];
    if (targets.length > 1) graph.issues.push({ fileId: file.id, message: `Dateipfad „${path}“ ist mehrfach vorhanden.` });
    if (targets.length) for (const target of targets) edge(source.id, fileNodeId(target.id), label, 'file');
    else {
      const id = `external-file:${path}`;
      if (!nodes.has(id)) addNode({ id, name: path, kind: 'Datei', category: 'file', external: true });
      edge(source.id, id, label, 'file');
    }
    return targets;
  };

  // Definitions first, so references can resolve across every file regardless of order.
  for (const file of files) {
    const path = filePath(file);
    paths.set(path, [...(paths.get(path) ?? []), file]);
    addNode({ id: fileNodeId(file.id), name: path, kind: 'Datei', category: 'file', fileId: file.id, filePath: path });
  }
  for (const file of files) {
    if (file.kind === 'dockerfile') {
      const stages = new Map<string,string>(); let current = '', index = 0, count = 0;
      const source = (name: string) => {
        if (stages.has(name)) return stages.get(name)!;
        const id = `docker-image:${JSON.stringify(name)}`;
        if (!nodes.has(id)) addNode({ id,name,kind:'Image / Build-Kontext',category:'resource',external:true });
        return id;
      };
      for (const root of file.state?.blocks?.blocks ?? []) {
        if (root.type !== 'df_file' || root.disabledReasons?.length || root.enabled === false) continue;
        for (let block = root.next?.block; block && ++count < 5000; block = block.next?.block) {
          if (block.disabledReasons?.length || block.enabled === false) continue;
          const fields = block.fields ?? {};
          if (block.type === 'df_from') {
            const image = nameOf(fields.IMAGE) || 'alpine:3', base = source(image), name = nameOf(fields.STAGE) || `Phase ${index}`;
            current = `docker-stage:${file.id}:${index}`;
            addNode({id:current,name,kind:'Build-Phase',category:'resource',fileId:file.id,filePath:filePath(file)});
            edge(fileNodeId(file.id),current,'enthält','contains'); edge(current,base,'FROM','dependency');
            stages.set(String(index++),current); if (fields.STAGE) stages.set(nameOf(fields.STAGE),current);
          } else if (current && block.type === 'df_copy' && fields.FROM) edge(current,source(nameOf(fields.FROM)),'COPY --from','dependency');
        }
      }
      continue;
    }
    let serial = 0;
    const collect = (raw: unknown, depth = 0) => {
      const doc = record(raw);
      if (!Object.keys(doc).length || depth > 12) return;
      if (doc.kind === 'List' || doc.kind?.endsWith('List') && Array.isArray(doc.items)) { list(doc.items).forEach((item) => collect(item, depth + 1)); return; }
      if (doc.kind === 'Template') { list(doc.objects).forEach((item) => collect(item, depth + 1)); return; }
      if (doc.kind && doc.apiVersion) {
        const kind = nameOf(doc.kind);
        const name = nameOf(doc.metadata?.name || doc.metadata?.generateName) || `(ohne Namen ${++serial})`;
        const namespace = clusterKinds.has(kind) ? '' : nameOf(doc.metadata?.namespace) || 'default';
        const node = addNode({ id: `resource:${file.id}:${serial++}`, name, kind, namespace, category: workloadKinds.has(kind) ? 'workload' : 'resource', fileId: file.id, filePath: filePath(file) }, kubeKey(kind, namespace, name));
        edge(fileNodeId(file.id), node.id, 'enthält', 'contains');
        work.push({ node, doc, file, compose: false });
      } else if (doc.services || doc.volumes || doc.networks || doc.configs || doc.secrets || doc.include) {
        for (const [section, kind] of [['services', 'Compose-Service'], ['volumes', 'Volume'], ['networks', 'Netzwerk'], ['configs', 'Config'], ['secrets', 'Compose-Secret']]) {
          for (const [name, value] of Object.entries(record(doc[section]))) {
            const node = addNode({ id: `compose:${file.id}:${serial++}`, name, kind, category: section === 'services' ? 'service' : 'resource', fileId: file.id, filePath: filePath(file), external: !!record(value).external }, composeKey(file.id, kind, name));
            edge(fileNodeId(file.id), node.id, 'enthält', 'contains');
            work.push({ node, doc: record(value), file, compose: true });
          }
        }
        if (Object.values(record(doc.services)).some((value) => !record(value).network_mode && record(value).networks == null) && !identities.has(composeKey(file.id, 'Netzwerk', 'default'))) {
          const node = addNode({ id: `compose:${file.id}:${serial++}`, name: 'default', kind: 'Netzwerk', category: 'resource', fileId: file.id, filePath: filePath(file) }, composeKey(file.id, 'Netzwerk', 'default'));
          edge(fileNodeId(file.id), node.id, 'enthält', 'contains');
        }
        for (const include of list(doc.include)) {
          const raw = typeof include === 'string' ? include : include?.path;
          for (const path of Array.isArray(raw) ? raw : [raw]) work.push({ node: nodes.get(fileNodeId(file.id))!, doc: { include: path }, file, compose: true });
        }
      }
    };
    try {
      for (const doc of parseAllDocuments(getYaml(file))) {
        if (doc.errors.length) throw new Error();
        collect(doc.toJS({ maxAliasCount: 100 }));
      }
    } catch {
      graph.issues.push({ fileId: file.id, message: 'Diese Datei konnte nicht vollständig ausgewertet werden. YAML und Block-Probleme prüfen.' });
    }
  }

  const includedFiles = new Map<string, string[]>();
  for (const item of work) if (item.compose && item.doc.include) {
    const included = paths.get(relativePath(item.file, nameOf(item.doc.include))) ?? [];
    includedFiles.set(item.file.id, [...(includedFiles.get(item.file.id) ?? []), ...included.map((file) => file.id)]);
  }
  const includedIdentities = (fileId: string, kind: string, name: string, seen = new Set<string>()): DependencyNode[] => {
    if (seen.has(fileId)) return [];
    seen.add(fileId);
    return [...(identities.get(composeKey(fileId, kind, name)) ?? []), ...(includedFiles.get(fileId) ?? []).flatMap((id) => includedIdentities(id, kind, name, seen))];
  };
  for (const { node, doc, file, compose } of work) {
    if (compose) {
      const ref = (kind: string, name: unknown, label: string, dependency = false, targetFile = file) => {
        const targetName = nameOf(name);
        if (!targetName) return;
        const identity = composeKey(targetFile.id, kind, targetName);
        if (!identities.has(identity)) {
          const included = includedIdentities(targetFile.id, kind, targetName);
          if (included.length) {
            if (included.length > 1) graph.issues.push({ fileId: file.id, message: `${kind} „${targetName}“ ist in eingebundenen Dateien mehrfach definiert.` });
            for (const target of included) edge(node.id, target.id, label, dependency ? 'dependency' : 'reference');
            return;
          }
        }
        link(node, identity, { name: targetName, kind, category: kind === 'Compose-Service' ? 'service' : 'resource' }, label, dependency ? 'dependency' : 'reference');
      };
      if (doc.include) fileReference(node, file, doc.include, 'include');
      if (node.kind !== 'Compose-Service') {
        if (doc.file) fileReference(node, file, doc.file, 'liest Datei');
        continue;
      }
      for (const name of names(doc.depends_on)) ref('Compose-Service', name, 'depends_on', true);
      for (const name of list(doc.links)) ref('Compose-Service', nameOf(name).split(':')[0], 'links', true);
      for (const value of list(doc.volumes_from)) {
        const name = nameOf(value);
        if (!name.startsWith('container:')) ref('Compose-Service', name.split(':')[0], 'volumes_from', true);
      }
      for (const field of ['network_mode', 'pid', 'ipc']) if (nameOf(doc[field]).startsWith('service:')) ref('Compose-Service', doc[field].slice(8), field, true);
      if (doc.extends) {
        const extension = typeof doc.extends === 'string' ? { service: doc.extends } : record(doc.extends);
        if (extension.file) {
          const targets = fileReference(node, file, extension.file, 'extends.file');
          for (const target of targets) ref('Compose-Service', extension.service, 'extends', true, target);
        } else ref('Compose-Service', extension.service, 'extends', true);
      }
      for (const [section, kind] of [['networks', 'Netzwerk'], ['configs', 'Config'], ['secrets', 'Compose-Secret']]) {
        for (const entry of Array.isArray(doc[section]) ? doc[section] : Object.keys(record(doc[section]))) ref(kind, typeof entry === 'string' ? entry : entry?.source, section);
      }
      if (!doc.network_mode && doc.networks == null) ref('Netzwerk', 'default', 'Standardnetzwerk');
      for (const entry of list(doc.volumes)) {
        if (typeof entry === 'string') {
          const source = entry.split(':')[0];
          // A single path is an anonymous volume; bind paths are not named resources.
          if (entry.includes(':') && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(source)) ref('Volume', source, 'Volume');
        } else if (entry?.type !== 'bind' && entry?.source) ref('Volume', entry.source, 'Volume');
      }
      for (const entry of Array.isArray(doc.env_file) ? doc.env_file : [doc.env_file]) fileReference(node, file, typeof entry === 'string' ? entry : entry?.path, 'env_file');
      if (doc.build && !record(doc.build).dockerfile_inline) {
        const build = typeof doc.build === 'string' ? { context:doc.build } : record(doc.build);
        const context = nameOf(build.context).replace(/\/$/, '');
        if (!/^(?:[a-z]+:\/\/|git@)/i.test(context)) fileReference(node, file, context ? `${context}/${build.dockerfile || 'Dockerfile'}` : build.dockerfile || 'Dockerfile', 'Dockerfile');
      }
      continue;
    }

    const ref = (kind: unknown, rawName: unknown, label: string, namespace = node.namespace ?? 'default', dependency = false) => {
      let targetKind = nameOf(kind), name = nameOf(rawName);
      if (!targetKind || !name) return;
      // OpenShift image tags resolve to their ImageStream when the tag is implicit.
      if (targetKind === 'ImageStreamTag' && !identities.has(kubeKey(targetKind, namespace, name)) && identities.has(kubeKey('ImageStream', namespace, name.split(':')[0]))) {
        targetKind = 'ImageStream'; name = name.split(':')[0];
      }
      link(node, kubeKey(targetKind, namespace, name), { name, kind: targetKind, namespace: clusterKinds.has(targetKind) ? '' : namespace, category: workloadKinds.has(targetKind) ? 'workload' : 'resource' }, label, dependency ? 'dependency' : 'reference');
    };
    const podSpec = node.kind === 'Pod' ? doc.spec : node.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.spec : doc.spec?.template?.spec;
    if (podSpec && workloadKinds.has(node.kind)) {
      ref('ServiceAccount', podSpec.serviceAccountName || podSpec.serviceAccount, 'ServiceAccount');
      for (const secret of list(podSpec.imagePullSecrets)) ref('Secret', secret?.name, 'imagePullSecret');
      for (const container of [...list(podSpec.containers), ...list(podSpec.initContainers), ...list(podSpec.ephemeralContainers)]) {
        for (const env of list(container?.env)) {
          ref('Secret', env?.valueFrom?.secretKeyRef?.name, 'Secret-Wert');
          ref('ConfigMap', env?.valueFrom?.configMapKeyRef?.name, 'ConfigMap-Wert');
        }
        for (const env of list(container?.envFrom)) {
          ref('Secret', env?.secretRef?.name, 'envFrom Secret');
          ref('ConfigMap', env?.configMapRef?.name, 'envFrom ConfigMap');
        }
      }
      for (const volume of list(podSpec.volumes)) {
        ref('PersistentVolumeClaim', volume?.persistentVolumeClaim?.claimName, 'PVC');
        ref('ConfigMap', volume?.configMap?.name, 'ConfigMap-Volume');
        ref('Secret', volume?.secret?.secretName, 'Secret-Volume');
        ref('Secret', volume?.csi?.nodePublishSecretRef?.name, 'CSI-Secret');
        for (const projection of list(volume?.projected?.sources)) {
          ref('Secret', projection?.secret?.name, 'projiziertes Secret');
          ref('ConfigMap', projection?.configMap?.name, 'projizierte ConfigMap');
        }
      }
    }
    if (node.kind === 'Service') {
      const selector = record(doc.spec?.selector);
      if (Object.keys(selector).length) {
        for (const target of work.filter((w) => !w.compose && workloadKinds.has(w.node.kind) && w.node.namespace === node.namespace)) {
          const labels = record(target.node.kind === 'Pod' ? target.doc.metadata?.labels : target.node.kind === 'CronJob' ? target.doc.spec?.jobTemplate?.spec?.template?.metadata?.labels : target.doc.spec?.template?.metadata?.labels);
          if (Object.entries(selector).every(([key, value]) => labels[key] === value)) edge(node.id, target.node.id, 'selektiert Pods');
        }
      }
    }
    if (node.kind === 'Ingress') {
      const backend = (value: any) => ref('Service', value?.service?.name || value?.serviceName, 'Ingress-Backend');
      backend(doc.spec?.defaultBackend || doc.spec?.backend);
      for (const rule of list(doc.spec?.rules)) for (const path of list(rule?.http?.paths)) backend(path?.backend);
      for (const tls of list(doc.spec?.tls)) ref('Secret', tls?.secretName, 'TLS-Secret');
    }
    if (node.kind === 'Route') for (const target of [doc.spec?.to, ...list(doc.spec?.alternateBackends)]) ref(target?.kind || 'Service', target?.name, 'Route-Ziel');
    if (node.kind === 'HorizontalPodAutoscaler') ref(doc.spec?.scaleTargetRef?.kind, doc.spec?.scaleTargetRef?.name, 'skaliert');
    if (node.kind === 'PersistentVolumeClaim') ref('PersistentVolume', doc.spec?.volumeName, 'gebundenes Volume', '');
    if (node.kind === 'RoleBinding' || node.kind === 'ClusterRoleBinding') {
      ref(doc.roleRef?.kind, doc.roleRef?.name, 'Rolle');
      for (const subject of list(doc.subjects)) if (subject?.kind === 'ServiceAccount') ref('ServiceAccount', subject.name, 'Berechtigung für', subject.namespace || node.namespace || 'default');
    }
    if (node.kind === 'ServiceAccount') for (const secret of [...list(doc.secrets), ...list(doc.imagePullSecrets)]) ref('Secret', secret?.name, 'Secret');
    if (node.kind === 'BuildConfig') {
      for (const from of [doc.spec?.output?.to, doc.spec?.strategy?.dockerStrategy?.from, doc.spec?.strategy?.sourceStrategy?.from, ...list(doc.spec?.source?.images).map((image) => image?.from)]) {
        if (from?.kind && from.kind !== 'DockerImage') ref(from.kind, from.name, 'Build-Image', from.namespace || node.namespace);
      }
      for (const name of [doc.spec?.strategy?.dockerStrategy?.pullSecret?.name, doc.spec?.strategy?.sourceStrategy?.pullSecret?.name, doc.spec?.output?.pushSecret?.name, doc.spec?.source?.sourceSecret?.name]) ref('Secret', name, 'Build-Secret');
    }
    for (const trigger of list(doc.spec?.triggers)) {
      const from = trigger?.imageChangeParams?.from;
      if (from) ref(from.kind || 'ImageStreamTag', from.name, 'Image-Trigger', from.namespace || node.namespace);
    }
  }

  // Surface file-to-file dependencies as well as their underlying resource links.
  for (const relation of [...edges.values()]) {
    if (relation.type === 'contains') continue;
    const source = nodes.get(relation.source), target = nodes.get(relation.target);
    if (source?.fileId && target?.fileId && source.fileId !== target.fileId) edge(fileNodeId(source.fileId), fileNodeId(target.fileId), 'verweist auf', 'file');
  }
  graph.nodes = [...nodes.values()];
  graph.edges = [...edges.values()];
  markDependencyCycles(graph);
  graph.issues = graph.issues.filter((issue, index, all) => all.findIndex((other) => other.fileId === issue.fileId && other.message === issue.message) === index);
  return graph;
}

/** Only startup/inheritance dependencies are cycles; selectors and containment are not. */
function markDependencyCycles(graph: DependencyGraph) {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.type === 'dependency') outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  let serial = 0;
  const index = new Map<string, number>(), low = new Map<string, number>(), component = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>(), cyclic = new Set<number>();
  const visit = (id: string) => {
    index.set(id, serial); low.set(id, serial++); stack.push(id); onStack.add(id);
    for (const next of outgoing.get(id) ?? []) {
      if (!index.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, index.get(next)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const members: string[] = [];
    let member: string;
    do { member = stack.pop()!; onStack.delete(member); members.push(member); component.set(member, index.get(id)!); } while (member !== id);
    if (members.length > 1 || (outgoing.get(id) ?? []).includes(id)) cyclic.add(index.get(id)!);
  };
  for (const node of graph.nodes) if (!index.has(node.id)) visit(node.id);
  for (const node of graph.nodes) node.cycle = cyclic.has(component.get(node.id)!);
  for (const edge of graph.edges) edge.cycle = edge.type === 'dependency' && cyclic.has(component.get(edge.source)!) && component.get(edge.source) === component.get(edge.target);
}
