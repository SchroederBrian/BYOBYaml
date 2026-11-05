import validateCompose from './generated/compose.js';
import * as kube from './generated/kubernetes.js';
import resources from './generated/resources.json';
import provenance from './generated/provenance.json';
import { normalizeDefinition, parameterValue, type CustomBlockDefinition, type DesignIssue } from './model';
import { previewRecipe } from './recipe';

const dns = (value: unknown, max = 253) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.split('.').every((part) => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part));
const image = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s|\$\{|\.\.|[<>"'`]/.test(value) && /^(?:[A-Za-z0-9_.:[\]-]+\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?(?:@sha256:[a-fA-F0-9]{64})?$/.test(value);
const quantity = (value: unknown) => typeof value === 'number' ? Number.isFinite(value) && value >= 0 : typeof value === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.test(value);
const list = (value: any) => Array.isArray(value) ? value : [];
const labelName = (value: unknown) => typeof value === 'string' && value.length <= 63 && (value === '' || /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(value));
const qualifiedName = (value: string) => { const parts = value.split('/'); return parts.length === 1 ? !!value && labelName(value) : parts.length === 2 && dns(parts[0]) && !!parts[1] && labelName(parts[1]); };
const issuesFromSchema = (errors: any[] | null | undefined): DesignIssue[] => (errors ?? []).slice(0, 16).map((error) => ({ path: error.instancePath || '/', message: error.keyword === 'additionalProperties' ? `Unbekanntes Feld „${error.params.additionalProperty}“.` : error.keyword === 'required' ? `Pflichtfeld „${error.params.missingProperty}“ fehlt.` : error.keyword === 'type' ? `Hier ist ${error.params.type === 'integer' ? 'eine ganze Zahl' : error.params.type === 'string' ? 'Text' : error.params.type === 'array' ? 'eine Liste' : error.params.type === 'object' ? 'ein Objekt' : error.params.type} erforderlich.` : error.keyword === 'enum' ? 'Dieser Auswahlwert ist nicht zulässig.' : error.keyword === 'pattern' ? 'Der Wert entspricht nicht dem erlaubten Format.' : `Schema-Regel „${error.keyword}“ ist nicht erfüllt.` }));

export function validateDocument(doc: any): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const add = (message: string, path = '/') => issues.push({ message, path });
  const checkPort = (value: any, path: string) => { if (!Number.isInteger(value) || value < 1 || value > 65535) add('Ein Port muss eine ganze Zahl zwischen 1 und 65535 sein.', path); };
  if (!doc?.apiVersion && doc?.services) {
    if (!validateCompose(doc)) issues.push(...issuesFromSchema(validateCompose.errors));
    const names = Object.keys(doc.services ?? {});
    if (!names.length) add('Mindestens ein Compose-Service ist erforderlich.');
    for (const [name, service] of Object.entries(doc.services ?? {}) as [string, any][]) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) add('Ungültiger Compose-Service-Name.', `/services/${name}`);
      if (!service.image && !service.build) add('Ein Service benötigt ein Image oder eine Build-Quelle.', `/services/${name}`);
      if (service.image && !image(service.image)) add('Bitte eine gültige Image-Referenz angeben, zum Beispiel nginx:alpine.', `/services/${name}/image`);
      for (const port of list(service.ports)) {
        if (typeof port === 'number') checkPort(port, `/services/${name}/ports`);
        else if (port && typeof port === 'object') { checkPort(port.target, `/services/${name}/ports/target`); if (port.published && (!/^\d+(?:-\d+)?$/.test(String(port.published)) || String(port.published).split('-').some((part) => +part < 1 || +part > 65535))) add('Ungültiger veröffentlichter Port.', `/services/${name}/ports`); }
        else if (typeof port === 'string') {
          const value = port.replace(/\/(tcp|udp|sctp)$/, ''), parts = value.split(':');
          for (const part of parts.slice(-Math.min(2, parts.length))) { const range = part.split('-').map(Number); if (range.some((n) => !Number.isInteger(n) || n < 1 || n > 65535) || range.length > 2 || range.length === 2 && range[0] > range[1]) add('Ungültiger Port oder Portbereich.', `/services/${name}/ports`); }
        }
      }
      const deps = Array.isArray(service.depends_on) ? service.depends_on : Object.keys(service.depends_on ?? {});
      for (const target of deps) if (target === name) add('Ein Service darf nicht von sich selbst abhängen.', `/services/${name}/depends_on`);
      if (service.deploy?.replicas !== undefined && (!Number.isInteger(service.deploy.replicas) || service.deploy.replicas < 0)) add('Replicas müssen eine nicht negative ganze Zahl sein.', `/services/${name}/deploy/replicas`);
    }
    const active = new Set<string>(), done = new Set<string>();
    const visit = (name: string): boolean => {
      if (active.has(name)) return true;
      if (done.has(name) || !doc.services[name]) return false;
      active.add(name);
      const deps = doc.services[name].depends_on;
      if ((Array.isArray(deps) ? deps : Object.keys(deps ?? {})).some(visit)) return true;
      active.delete(name); done.add(name); return false;
    };
    if (names.some(visit)) add('Service-Abhängigkeiten enthalten einen Kreis.', '/services');
    return issues;
  }
  const key = `${doc?.apiVersion}:${doc?.kind}`;
  const symbol = (resources as Record<string,string>)[key];
  if (!symbol) return [{ message: `„${key}“ gehört nicht zu den für eigene Blöcke freigegebenen Kubernetes-APIs.`, path: '/' }];
  const validate = (kube as Record<string, { (doc: unknown): boolean; errors?: any[] | null }>)[symbol];
  if (!validate(doc)) issues.push(...issuesFromSchema(validate.errors));
  if (!dns(doc.metadata?.name)) add('Ein gültiger DNS-Ressourcenname ist erforderlich (Kleinbuchstaben, Zahlen, Punkt oder Bindestrich).', '/metadata/name');
  if (doc.metadata?.namespace && !dns(doc.metadata.namespace, 63)) add('Ungültiger Namespace.', '/metadata/namespace');
  const pod = doc.kind === 'Pod' ? doc.spec : doc.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.spec : doc.spec?.template?.spec;
  const podMeta = doc.kind === 'Pod' ? doc.metadata : doc.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.metadata : doc.spec?.template?.metadata;
  for (const meta of [doc.metadata, podMeta]) if (meta) {
    for (const [key, value] of Object.entries(meta.labels ?? {})) if (!qualifiedName(key) || !labelName(value)) add('Ungültiger Label-Schlüssel oder Label-Wert.', '/metadata/labels');
    for (const key of Object.keys(meta.annotations ?? {})) if (!qualifiedName(key)) add('Ungültiger Annotation-Schlüssel.', '/metadata/annotations');
  }
  if (pod) {
    if (!list(pod.containers).length) add('Mindestens ein Container ist erforderlich.', '/spec/template/spec/containers');
    const containerNames = new Set<string>();
    for (const [index, container] of [...list(pod.containers), ...list(pod.initContainers)].entries()) {
      const path = `/spec/template/spec/containers/${index}`;
      if (!dns(container.name, 63)) add('Ungültiger Container-Name.', `${path}/name`);
      if (containerNames.has(container.name)) add('Container-Namen müssen eindeutig sein.', `${path}/name`); containerNames.add(container.name);
      if (!image(container.image)) add('Der Container benötigt eine gültige Image-Referenz.', `${path}/image`);
      for (const port of list(container.ports)) checkPort(port.containerPort, `${path}/ports`);
      for (const section of ['limits','requests']) for (const [resource, value] of Object.entries(container.resources?.[section] ?? {})) if (!quantity(value)) add(`Ungültige Ressourcenmenge für ${resource}.`, `${path}/resources/${section}`);
      for (const mount of list(container.volumeMounts)) {
        if (![...list(pod.volumes), ...list(doc.spec?.volumeClaimTemplates).map((claim) => claim.metadata)].some((volume) => volume.name === mount.name)) add(`Volume „${mount.name}“ ist im Pod nicht definiert.`, `${path}/volumeMounts`);
        if (typeof mount.mountPath !== 'string' || !mount.mountPath.startsWith('/')) add('Ein Mount-Pfad muss absolut sein.', `${path}/volumeMounts`);
      }
      for (const key of ['runAsUser','runAsGroup']) if (container.securityContext?.[key] !== undefined && (!Number.isInteger(container.securityContext[key]) || container.securityContext[key] < 0)) add(`${key} muss eine nicht negative ganze Zahl sein.`, `${path}/securityContext`);
      for (const probeName of ['livenessProbe','readinessProbe','startupProbe']) {
        const probe = container[probeName]; if (!probe) continue;
        if (['httpGet','tcpSocket','exec','grpc'].filter((key) => probe[key]).length !== 1) add('Eine Probe benötigt genau eine Prüfmethode.', `${path}/${probeName}`);
        for (const field of ['timeoutSeconds','periodSeconds','successThreshold','failureThreshold']) if (probe[field] !== undefined && (!Number.isInteger(probe[field]) || probe[field] < 1)) add(`${field} muss mindestens 1 sein.`, `${path}/${probeName}/${field}`);
      }
    }
    for (const [key, value] of Object.entries(doc.spec?.selector?.matchLabels ?? doc.spec?.selector ?? {})) {
      if (typeof value === 'string' && podMeta?.labels?.[key] !== value) add(`Selektor „${key}“ passt nicht zu den Pod-Labels.`, '/spec/selector');
    }
    for (const volume of list(pod.volumes)) {
      if (!dns(volume.name, 63)) add('Ungültiger Volume-Name.', '/spec/template/spec/volumes');
      const source = ['configMap','secret','persistentVolumeClaim','emptyDir','hostPath','projected','csi','ephemeral','downwardAPI','nfs'].filter((key) => volume[key] !== undefined);
      if (source.length !== 1) add('Ein Volume benötigt genau eine Quelle.', '/spec/template/spec/volumes');
      for (const key of ['configMap','secret','projected']) if (volume[key]?.defaultMode !== undefined && (!Number.isInteger(volume[key].defaultMode) || volume[key].defaultMode < 0 || volume[key].defaultMode > 511)) add('Dateirechte müssen zwischen 0000 und 0777 liegen.', '/spec/template/spec/volumes');
    }
    if (new Set(list(pod.volumes).map((volume) => volume.name)).size !== list(pod.volumes).length) add('Volume-Namen müssen eindeutig sein.', '/spec/template/spec/volumes');
    if (['Deployment','StatefulSet','DaemonSet'].includes(doc.kind) && pod.restartPolicy && pod.restartPolicy !== 'Always') add('Dieser Workload unterstützt nur restartPolicy Always.', '/spec/template/spec/restartPolicy');
    if (['Job','CronJob'].includes(doc.kind) && !['OnFailure','Never'].includes(pod.restartPolicy)) add('Jobs benötigen restartPolicy OnFailure oder Never.', '/spec/template/spec/restartPolicy');
  }
  if (doc.kind === 'Service') {
    const ports = list(doc.spec?.ports), names = new Set<string>();
    if (doc.spec?.type !== 'ExternalName' && !ports.length) add('Ein Service benötigt mindestens einen Port.', '/spec/ports');
    if (doc.spec?.type === 'ExternalName' && !dns(doc.spec.externalName)) add('ExternalName benötigt einen gültigen DNS-Namen.', '/spec/externalName');
    for (const port of ports) {
      checkPort(port.port, '/spec/ports'); if (typeof port.targetPort === 'number') checkPort(port.targetPort, '/spec/ports/targetPort');
      if (port.nodePort !== undefined) checkPort(port.nodePort, '/spec/ports/nodePort');
      if (ports.length > 1 && !port.name || port.name && (!dns(port.name,63) || names.has(port.name))) add('Service-Ports benötigen eindeutige gültige Namen.', '/spec/ports/name');
      if (port.name) names.add(port.name);
    }
  }
  if (doc.kind === 'Ingress') {
    if (!doc.spec?.defaultBackend && !list(doc.spec?.rules).length) add('Ein Ingress benötigt Regeln oder ein Standardziel.', '/spec');
    for (const rule of list(doc.spec?.rules)) {
      if (rule.host && !dns(String(rule.host).replace(/^\*\./,''))) add('Ungültiger Ingress-Hostname.', '/spec/rules/host');
      for (const path of list(rule.http?.paths)) {
        if (!path.path?.startsWith('/')) add('Ingress-Pfade müssen mit / beginnen.', '/spec/rules/http/paths');
        if (path.backend?.service?.port?.number !== undefined) checkPort(path.backend.service.port.number, '/spec/rules/http/paths/backend/service/port');
        if (!path.backend?.service?.name || !dns(path.backend.service.name,63)) add('Ungültiger Service-Name im Ingress.', '/spec/rules/http/paths/backend/service/name');
      }
    }
  }
  if (doc.kind === 'PersistentVolumeClaim' && !quantity(doc.spec?.resources?.requests?.storage)) add('Eine gültige Speichergröße ist erforderlich, zum Beispiel 1Gi.', '/spec/resources/requests/storage');
  if (doc.kind === 'HorizontalPodAutoscaler' && (doc.spec?.minReplicas > doc.spec?.maxReplicas || !list(doc.spec?.metrics).length)) add('Der Autoscaler benötigt Metriken und minReplicas darf maxReplicas nicht überschreiten.', '/spec');
  if (doc.kind === 'ConfigMap' || doc.kind === 'Secret') {
    for (const field of ['data','stringData','binaryData']) for (const [key, value] of Object.entries(doc[field] ?? {})) {
      if (!/^[A-Za-z0-9._-]{1,253}$/.test(key)) add('Ungültiger Datenschlüssel.', `/${field}/${key}`);
      if ((doc.kind === 'Secret' && field === 'data' || field === 'binaryData') && (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))) add('Dieser Wert muss gültig Base64-kodiert sein.', `/${field}/${key}`);
    }
  }
  return issues;
}

export function validateDefinition(raw: unknown) {
  let definition: CustomBlockDefinition;
  try { definition = normalizeDefinition(raw); }
  catch (error) { return { definition: null, issues: [{ message: error instanceof Error ? error.message : 'Ungültige Definition.' }] as DesignIssue[], yaml: '', hint: '' }; }
  const issues: DesignIssue[] = [];
  for (const parameter of definition.parameters) try { parameterValue(parameter, parameter.value); } catch (error) { issues.push({ parameterId: parameter.id, message: (error as Error).message }); }
  try {
    const preview = previewRecipe(definition);
    issues.push(...preview.issues, ...preview.documents.flatMap(validateDocument));
    return { definition, issues, yaml: preview.yaml, hint: preview.hint };
  } catch (error) { issues.push({ message: error instanceof Error ? error.message : 'Die Vorschau konnte nicht erstellt werden.' }); }
  return { definition, issues, yaml: '', hint: '' };
}
export const validationProvenance = provenance;
