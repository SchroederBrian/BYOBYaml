import * as Blockly from 'blockly/core';
import YAML from 'yaml';
import { generate } from './blocks/generator';
import { registerBlocks } from './blocks/register';
import { argValue, hasValueBlock, loadState, setArgValue, type ValueSession } from './blocks/value';
import { getRuntimeSpec } from './custom-blocks/runtime';
import { buildDependencyGraph, type DependencyGraph, type DependencyEdge } from './dependencies';
import { resolveVariables, type Project, type ProjectFile, type Variable } from './project';
import { yamlForFile } from './projectYaml';

export interface HelmOptions { name: string; version: string; description: string; fileIds: string[]; /** seed and clock for value blocks; one per export */ session?: ValueSession }
export interface HelmChartFile { path: string; content: string }
export interface HelmBinding {
  id: string; name: string; path: string[]; variable?: Variable; fileId?: string;
  required: boolean; types: Set<'number' | 'boolean' | 'json'>; usedBy: Set<string>;
}
export interface HelmChart {
  name: string; version: string; files: HelmChartFile[]; bindings: HelmBinding[];
  errors: string[]; warnings: string[]; graph: DependencyGraph; resourceCount: number;
}

const VAR = /\$\{\{([A-Za-z_][\w.-]*)\}\}|\$\{([A-Za-z_][\w.-]*)\}/g;
const TOKEN = /BYOBHELMVAR\d+TOKEN/g;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const yaml = (value: unknown) => YAML.stringify(value, { version: '1.1', lineWidth: 0, aliasDuplicateObjects: false });
const slug = (value: string, fallback: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '') || fallback;
export const helmChartName = (title: string) => slug(title, 'mein-chart');
const valueAt = (source: any, path: (string | number)[]) => path.reduce((value, key) => value?.[key], source);
const fileLabel = (file: ProjectFile) => file.folder ? `${file.folder}/${file.name}` : file.name;
const lastVariable = (variables: Variable[] | undefined, name: string) => [...(variables ?? [])].reverse().find((variable) => variable.name === name);
const clusterScoped = new Set(['Namespace', 'ClusterRole', 'ClusterRoleBinding', 'CustomResourceDefinition', 'PersistentVolume', 'StorageClass', 'SecurityContextConstraints', 'Node', 'PriorityClass']);

/** Build templates from placeholder-bearing fields, never from decrypted vault values. */
export function buildHelmChart(project: Project, options: HelmOptions): HelmChart {
  const chart: HelmChart = { name: options.name, version: options.version, files: [], bindings: [], errors: [], warnings: [], graph: { nodes: [], edges: [], issues: [] }, resourceCount: 0 };
  if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$/.test(options.name)) chart.errors.push('Chart-Name: 1–63 Kleinbuchstaben, Zahlen oder Bindestriche; mit einem Buchstaben beginnen und ohne Bindestrich enden.');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(options.version)) chart.errors.push('Bitte eine SemVer-Version angeben, zum Beispiel 0.1.0.');
  const selected = project.files.filter((file) => options.fileIds.includes(file.id) && file.kind === 'k8s');
  if (!selected.length) chart.errors.push('Mindestens eine Kubernetes-/OpenShift-Datei auswählen.');
  const bindings = new Map<string, HelmBinding>();
  const tokens = new Map<string, { binding: HelmBinding; numeric: boolean; typed: boolean }>();
  const templatePaths = new Map<string, string[]>();
  const documents: { file: ProjectFile; doc: any; index: number; numericTokens: Set<string> }[] = [];
  const fileKeys = new Map(selected.map((file, index) => [file.id, `file${index + 1}-${slug(fileLabel(file).replace(/\.ya?ml$/i, ''), 'resource')}`]));
  const concrete = new Map<string, any[]>();
  const parameters = new Map<string, Map<string, { value?: string }>>();

  const bindingFor = (file: ProjectFile, name: string) => {
    const local = lastVariable(file.variables, name), global = lastVariable(project.variables, name);
    const parameter = parameters.get(file.id)?.get(name);
    const variable = local ?? global ?? (parameter?.value !== undefined ? { name, values: Object.fromEntries(project.envs.map((env) => [env, parameter.value!])) } : undefined);
    const scoped = !!local || !global && !!parameter;
    const path = scoped ? ['files', fileKeys.get(file.id)!, name] : global ? ['global', name] : ['external', name];
    const id = JSON.stringify(path);
    let binding = bindings.get(id);
    if (!binding) { binding = { id, name, path, variable, fileId: scoped ? file.id : undefined, required: !variable, types: new Set(), usedBy: new Set() }; bindings.set(id, binding); }
    binding.usedBy.add(file.id);
    return binding;
  };
  const resolveTokens = (text: string, env: string) => text.replace(TOKEN, (token) => tokens.get(token)?.binding.variable?.values[env] ?? '${' + (tokens.get(token)?.binding.name ?? 'UNBEKANNT') + '}');
  const expand = (raw: any, file: ProjectFile, numericTokens: Set<string>, depth = 0) => {
    if (!raw || typeof raw !== 'object' || depth > 12) return;
    if ((raw.kind === 'List' || typeof raw.kind === 'string' && raw.kind.endsWith('List')) && Array.isArray(raw.items)) { raw.items.forEach((item: any) => expand(item, file, numericTokens, depth + 1)); return; }
    if (raw.kind === 'Template') {
      for (const resource of raw.objects ?? []) expand(resource, file, numericTokens, depth + 1);
      chart.warnings.push(`${fileLabel(file)}: OpenShift-Template wird in seine Ressourcen aufgelöst. Generierte Parameter ohne festen Wert müssen extern angegeben werden.`);
      return;
    }
    if (!raw.apiVersion || !raw.kind || !raw.metadata?.name && !raw.metadata?.generateName) {
      chart.errors.push(`${fileLabel(file)}: Jede Ressource benötigt apiVersion, kind und metadata.name oder generateName.`); return;
    }
    documents.push({ file, doc: raw, index: documents.filter((entry) => entry.file.id === file.id).length, numericTokens });
  };

  registerBlocks();
  for (const file of selected) {
    const workspace = new Blockly.Workspace();
    const fileTokens: string[] = [], numericTokens = new Set<string>();
    try {
      try {
        const raw = YAML.parseAllDocuments(yamlForFile(file, resolveVariables(project, file), options.session)).map((doc) => doc.toJS({ maxAliasCount: 100 }));
        const flat: any[] = [], fileParameters = new Map<string, { value?: string }>();
        const flatten = (doc: any, depth = 0) => {
          if (depth > 12 || !doc) return;
          if (doc.kind === 'Template') {
            for (const parameter of doc.parameters ?? []) if (typeof parameter?.name === 'string') fileParameters.set(parameter.name, parameter.value === undefined ? {} : { value: String(parameter.value) });
            for (const item of doc.objects ?? []) flatten(item, depth + 1);
          } else if (typeof doc.kind === 'string' && doc.kind.endsWith('List') && Array.isArray(doc.items)) for (const item of doc.items) flatten(item, depth + 1);
          else flat.push(doc);
        };
        raw.forEach((doc) => flatten(doc)); concrete.set(file.id, flat); parameters.set(file.id, fileParameters);
      } catch { /* Unknown parameters can still be prepared using marker fields. */ }
      Blockly.Events.disable();
      loadState(file.state, workspace);
      for (const block of workspace.getAllBlocks(false)) {
        if (getRuntimeSpec(block.getRootBlock())?.shape !== 'hat') continue;
        let enabled = true;
        for (let ancestor: Blockly.Block | null = block; ancestor; ancestor = ancestor.getParent()) if (!ancestor.isEnabled()) enabled = false;
        if (!enabled) continue;
        for (const arg of getRuntimeSpec(block)?.args ?? []) {
          if (arg.kind !== 'text' && arg.kind !== 'multi' && arg.kind !== 'num') continue;
          if (hasValueBlock(block, arg.name)) continue; // computed at export; nothing to turn into a chart value
          const original = String(argValue(block, arg.name) ?? '');
          const numeric = arg.kind === 'num' && /^\$\{[A-Za-z_][\w.-]*\}$/.test(original.trim());
          const next = original.replace(VAR, (_match, typedName: string, plainName: string) => {
            const token = `BYOBHELMVAR${tokens.size}TOKEN`;
            const binding = bindingFor(file, typedName || plainName);
            tokens.set(token, { binding, numeric, typed: !!typedName });
            fileTokens.push(token); if (numeric) numericTokens.add(token);
            return token;
          });
          if (next !== original) setArgValue(block, arg.name, next);
        }
      }
      const generated = generate(workspace, {}, { passThroughUnknownVars: true, templateMode: true, session: options.session && { ...options.session, fileName: file.name } });
      if (generated.blocked) chart.errors.push(`${fileLabel(file)}: Eigene Blöcke konnten nicht für Helm vorbereitet werden.`);
      if (!generated.yaml.trim()) chart.errors.push(`${fileLabel(file)}: Keine exportierbaren Ressourcen vorhanden.`);
      const warnings = generated.warnings.filter((warning) => !warning.msg.includes('BYOBHELMVAR'));
      if (warnings.length) chart.errors.push(`${fileLabel(file)}: ${warnings.length} Block-Problem(e) vor dem Helm-Export beheben.`);
      let searchable = generated.yaml;
      for (const candidate of generated.yaml.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
        try { searchable += '\n' + atob(candidate); } catch { /* Not Base64 data. */ }
      }
      for (const token of fileTokens) {
        if (!searchable.includes(token)) chart.errors.push(`${fileLabel(file)}: Variable ${tokens.get(token)!.binding.name} wird von einem Block umgewandelt oder verworfen und kann hier nicht sicher parametrisiert werden.`);
      }
      for (const doc of YAML.parseAllDocuments(generated.yaml)) {
        if (doc.errors.length) throw new Error();
        expand(doc.toJS({ maxAliasCount: 100 }), file, numericTokens);
      }
    } catch {
      chart.errors.push(`${fileLabel(file)}: Blöcke konnten nicht in gültige Helm-Ressourcen umgewandelt werden.`);
    } finally { Blockly.Events.enable(); workspace.dispose(); }
  }

  const defaultEnv = project.envs.includes(project.activeEnv) ? project.activeEnv : project.envs[0];
  const lookup = (binding: HelmBinding) => {
    const expression = `index .Values ${binding.path.map((part) => JSON.stringify(part)).join(' ')}`;
    return binding.required ? `(required ${JSON.stringify(`Bitte ${binding.path.join('.')} setzen`)} (${expression}))` : `(${expression})`;
  };
  const helper = (type: string) => `byobyaml.${options.name}.${type}`;

  for (const { file, doc, index, numericTokens } of documents) {
    const expressions: string[] = [];
    const exprPrefix = `BYOBHELMEXPR${crypto.randomUUID().replace(/-/g, '')}X`;
    const renderScalar = (raw: string, path: (string | number)[], isKey = false) => {
      let text = raw, base64 = false;
      if (!text.includes('BYOBHELMVAR')) {
        try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(raw), (char) => char.charCodeAt(0))); if (decoded.includes('BYOBHELMVAR')) { text = decoded; base64 = true; } } catch { /* Ordinary scalar. */ }
      }
      if (!text.includes('BYOBHELMVAR')) return raw;
      const matches = [...text.matchAll(TOKEN)];
      if (!matches.length) return raw;
      const exact = matches.length === 1 && matches[0][0] === text;
      const token = exact ? tokens.get(matches[0][0]) : undefined;
      const resolvedPath = path.map((part) => typeof part === 'string' ? resolveTokens(part, defaultEnv) : part);
      const actual = valueAt(concrete.get(file.id)?.[index], resolvedPath);
      // Imported Extras may preserve a quoted mode. Pod volume permissions are
      // integers even when their source variable is stored as an octal string.
      const permissionMode = path.includes('volumes') && ['mode', 'defaultMode'].includes(String(path.at(-1)));
      const type = !isKey && !base64 ? exact && token?.typed ? 'json' : exact && numericTokens.has(matches[0][0]) || typeof actual === 'number' || permissionMode ? 'number' : typeof actual === 'boolean' ? 'boolean' : 'string' : 'string';
      const numericHelper = ['mode', 'defaultMode'].includes(String(path.at(-1))) ? 'mode' : 'number';
      let expression: string;
      if (exact && token) {
        const value = lookup(token.binding);
        if (type !== 'string') token.binding.types.add(type);
        expression = type === 'number' ? `include ${JSON.stringify(helper(numericHelper))} ${value}` : type === 'boolean' ? `include ${JSON.stringify(helper('boolean'))} ${value}` : type === 'json' ? `${value} | mustFromJson | toJson` : `${value} | toString${base64 ? ' | b64enc' : ''} | quote`;
      } else {
        const args: string[] = [];
        let cursor = 0;
        for (const match of matches) {
          if (match.index! > cursor) args.push(JSON.stringify(text.slice(cursor, match.index)));
          args.push(`(${lookup(tokens.get(match[0])!.binding)} | toString)`);
          cursor = match.index! + match[0].length;
        }
        if (cursor < text.length) args.push(JSON.stringify(text.slice(cursor)));
        const combined = `printf ${JSON.stringify('%s'.repeat(args.length))} ${args.join(' ')}`;
        expression = type === 'number' ? `include ${JSON.stringify(helper(numericHelper))} (${combined})` : type === 'boolean' ? `include ${JSON.stringify(helper('boolean'))} (${combined})` : `${combined}${base64 ? ' | b64enc' : ''} | quote`;
      }
      const placeholder = `${exprPrefix}${expressions.length}END`;
      expressions.push(`{{ ${expression} }}`);
      return placeholder;
    };
    const transform = (value: any, path: (string | number)[] = []): any => {
      if (typeof value === 'string') return renderScalar(value, path);
      if (Array.isArray(value)) return value.map((item, i) => transform(item, [...path, i]));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [renderScalar(key, path, true), transform(item, [...path, key])]));
      return value;
    };
    const isCrd = doc.kind === 'CustomResourceDefinition';
    if (isCrd && JSON.stringify(doc).includes('BYOBHELMVAR')) chart.errors.push(`${fileLabel(file)}: CRDs in crds/ dürfen keine Helm-Variablen enthalten. Statische CRD-Datei separat auswählen.`);
    let content = yaml(transform(doc));
    // Literal Go-template syntax in block data must remain data; never use tpl.
    if (!isCrd) content = content.replace(/\{\{/g, '{{ "{{" }}');
    expressions.forEach((expression, i) => { content = content.replaceAll(`${exprPrefix}${i}END`, expression); });
    const path = `${isCrd ? 'crds' : 'templates'}/${String(chart.resourceCount + 1).padStart(3, '0')}-${slug(fileLabel(file).replace(/\.ya?ml$/i, ''), 'resource')}-${slug(String(doc.kind), 'object')}.yaml`;
    templatePaths.set(file.id, [...(templatePaths.get(file.id) ?? []), path]);
    chart.files.push({ path, content }); chart.resourceCount++;
  }

  // Check identities for every environment, not just the preview environment.
  for (const env of project.envs) {
    const seen = new Map<string, string>();
    for (const { file, doc } of documents) {
      const name = resolveTokens(String(doc.metadata?.name ?? ''), env);
      if (!name || name.includes('${')) continue;
      const namespace = clusterScoped.has(doc.kind) ? '' : resolveTokens(String(doc.metadata?.namespace ?? 'default'), env);
      const identity = JSON.stringify([doc.apiVersion, doc.kind, namespace, name]);
      if (seen.has(identity)) chart.errors.push(`${env}: ${doc.kind} „${name}“${namespace ? ` (${namespace})` : ''} ist doppelt in ${seen.get(identity)} und ${fileLabel(file)}. Eine der Dateien abwählen.`);
      else seen.set(identity, fileLabel(file));
    }
  }

  chart.bindings = [...bindings.values()];
  const makeValues = (env: string) => {
    const values: Record<string, any> = Object.create(null);
    for (const binding of chart.bindings) {
      let target = values;
      for (const key of binding.path.slice(0, -1)) target = target[key] ??= Object.create(null);
      target[binding.path.at(-1)!] = binding.variable?.values[env] ?? '';
    }
    return values;
  };
  const schema: Record<string, any> = { $schema: 'https://json-schema.org/draft-07/schema#', type: 'object', properties: Object.create(null) };
  for (const binding of chart.bindings) {
    let parent = schema;
    for (const key of binding.path.slice(0, -1)) parent = parent.properties[key] ??= { type: 'object', properties: Object.create(null) };
    const property: any = { type: 'string', description: `${binding.name}${binding.required ? ' – extern angeben; kein Tresor-Wert wird exportiert.' : ''}` };
    if (binding.required) property.minLength = 1;
    if (binding.types.has('number')) property.pattern = NUMBER.source;
    if (binding.types.has('boolean')) property.pattern = '^(?:[tT][rR][uU][eE]|[fF][aA][lL][sS][eE])$';
    parent.properties[binding.path.at(-1)!] = property;
    for (const env of project.envs) {
      if (binding.required) continue;
      const value = binding.variable?.values[env] ?? '';
      if (binding.types.has('number') && (!NUMBER.test(value) || !Number.isFinite(Number(value)))) chart.errors.push(`${binding.name}: Für ${env} ist ein gültiger Zahlenwert erforderlich.`);
      if (binding.types.has('boolean') && !/^(true|false)$/i.test(value)) chart.errors.push(`${binding.name}: Für ${env} muss der Wert true oder false sein.`);
      if (binding.types.has('json')) { try { JSON.parse(value); } catch { chart.errors.push(`${binding.name}: Für ${env} ist gültiges JSON für einen typisierten OpenShift-Parameter erforderlich.`); } }
    }
  }
  const usedEnvPaths = new Set<string>();
  const envPaths = project.envs.map((env, index) => {
    let path = `values-${slug(env, `env-${index + 1}`)}.yaml`;
    if (usedEnvPaths.has(path)) path = `values-${slug(env, 'env')}-${index + 1}.yaml`;
    usedEnvPaths.add(path); return { env, path };
  });
  chart.files.unshift({ path: 'Chart.yaml', content: yaml({ apiVersion: 'v2', name: options.name, description: options.description, type: 'application', version: options.version }) },
    { path: 'values.yaml', content: `# Standardwerte: Umgebung ${JSON.stringify(defaultEnv)}\n# Werte bleiben Strings; Templates übernehmen die erforderlichen YAML-Typen.\n${yaml(makeValues(defaultEnv))}` },
    ...envPaths.map(({ env, path }) => ({ path, content: `# Umgebung ${JSON.stringify(env)}\n${yaml(makeValues(env))}` })),
    { path: 'values.schema.json', content: JSON.stringify(schema, null, 2) + '\n' });
  chart.files.push({ path: 'templates/_helpers.tpl', content: `{{- define ${JSON.stringify(helper('number'))} -}}\n{{- $value := toString . -}}\n{{- if not (regexMatch ${JSON.stringify(NUMBER.source)} $value) -}}{{- fail "Helm-Wert muss eine gültige Zahl sein" -}}{{- end -}}\n{{- $value | float64 -}}\n{{- end -}}\n\n{{- define ${JSON.stringify(helper('mode'))} -}}\n{{- $value := toString . -}}\n{{- if regexMatch "^0[0-7]+$" $value -}}{{- $value | toDecimal -}}{{- else -}}{{- include ${JSON.stringify(helper('number'))} $value -}}{{- end -}}\n{{- end -}}\n\n{{- define ${JSON.stringify(helper('boolean'))} -}}\n{{- $value := toString . | lower -}}\n{{- if not (has $value (list "true" "false")) -}}{{- fail "Helm-Wert muss true oder false sein" -}}{{- end -}}\n{{- $value -}}\n{{- end -}}\n` });
  if (chart.bindings.some((binding) => binding.required)) chart.warnings.push('Nicht definierte Variablen und Tresor-Secrets stehen leer unter external. Vor helm template/install in einer eigenen Values-Datei setzen.');
  const skipped = project.files.filter((file) => file.kind === 'compose').length;
  const dockerfiles = project.files.filter((file) => file.kind === 'dockerfile').length;
  if (dockerfiles) chart.warnings.push(`${dockerfiles} Dockerfile(s) sind Build-Anleitungen und werden nicht als Kubernetes-Ressourcen exportiert.`);
  if (skipped) chart.warnings.push(`${skipped} Compose-Datei(en) werden nicht in Kubernetes-Ressourcen konvertiert.`);
  chart.files.push({ path: '.helmignore', content: '.DS_Store\n.git/\n*.tgz\n' }, { path: 'README.md', content: `# ${options.name}\n\nAus BYOBYaml exportiert. Standard-Umgebung: ${JSON.stringify(defaultEnv)}.\n\n\`\`\`sh\nhelm lint ./\nhelm template mein-release ./\nhelm upgrade --install mein-release ./\n\`\`\`\n\n## Umgebungen\n\n${envPaths.map(({ env, path }) => `- ${JSON.stringify(env)}: \`helm template mein-release ./ -f ${path}\``).join('\n')}\n\n## Variablen\n\nGlobale Werte liegen unter \`global\`, lokale Werte unter \`files\`. Gleichnamige lokale Variablen überschreiben globale Werte nur in ihrer Quelldatei. Werte als Strings angeben; die Templates erzeugen Zahlen und boolesche Werte typgerecht.\n\n${chart.bindings.map((binding) => `- \`${binding.path.join('.')}\`${binding.required ? ': vor dem Rendern erforderlich' : ''}`).join('\n')}\n\n## Secrets und Grenzen\n\nDer verschlüsselte Tresor und seine entschlüsselten Werte sind nicht enthalten. Nicht definierte Referenzen müssen unter \`external\` angegeben werden. Beispiel: \`helm template mein-release ./ -f meine-geheimen-werte.yaml\`. Normale Variablenwerte und direkt in Blöcke geschriebene Werte sind Klartext. Kubernetes-Secret-Daten sind durch Base64 nicht verschlüsselt.\n\nRessourcennamen, Selektoren und explizite Namespaces bleiben erhalten. \`--namespace\` ersetzt keine expliziten Namespaces. Vor Installation vorhandene Ressourcen und die vom Cluster unterstützten APIs prüfen. CRDs unter \`crds/\` sind statisch; Helm aktualisiert/löscht sie nicht automatisch. Compose-Dateien sind nicht enthalten.\n` });

  chart.graph = buildDependencyGraph(selected, (file) => yamlForFile(file, resolveVariables(project, file), options.session));
  for (const node of chart.graph.nodes) if (node.category === 'file' && node.fileId) node.name = (templatePaths.get(node.fileId) ?? [node.name]).join(' + ');
  chart.graph.nodes.unshift({ id: 'helm:chart', name: options.name || 'Chart', kind: 'Helm-Chart', category: 'chart' }, { id: 'helm:values', name: 'values.yaml', kind: 'Values-Datei', category: 'value' });
  const edge = (source: string, target: string, label: string, type: DependencyEdge['type'] = 'reference') => chart.graph.edges.push({ id: JSON.stringify(['helm', source, target, label]), source, target, label, type });
  edge('helm:chart', 'helm:values', 'Standardwerte');
  for (const file of selected) edge('helm:chart', `file:${file.id}`, 'exportiert als Template');
  for (const binding of chart.bindings) {
    const id = `helm:value:${binding.id}`;
    chart.graph.nodes.push({ id, name: binding.path.join('.'), kind: binding.required ? 'Erforderlicher Wert' : 'Helm-Wert', category: 'value', external: binding.required });
    edge('helm:values', id, 'enthält', 'contains');
    for (const fileId of binding.usedBy) edge(id, `file:${fileId}`, 'parametrisiert');
  }
  chart.errors = [...new Set(chart.errors)]; chart.warnings = [...new Set(chart.warnings)];
  return chart;
}

/** POSIX ustar + browser-native gzip: a real Helm package, no runtime dependency. */
export async function downloadHelmChart(chart: HelmChart): Promise<void> {
  if (chart.errors.length) throw new Error('Bitte zuerst die Export-Probleme beheben.');
  if (typeof CompressionStream === 'undefined') throw new Error('Dieser Browser unterstützt den .tgz-Export nicht. Bitte einen aktuellen Browser verwenden.');
  const encoder = new TextEncoder(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  const write = (header: Uint8Array, offset: number, size: number, value: string) => {
    const bytes = encoder.encode(value); if (bytes.length > size) throw new Error('Dateipfad oder TAR-Feld ist zu lang.'); header.set(bytes, offset);
  };
  for (const file of chart.files) {
    const path = `${chart.name}/${file.path}`;
    if (path.split('/').some((part) => part === '..' || !part) || path.startsWith('/') || path.includes('\\')) throw new Error('Ungültiger Archivpfad.');
    const bytes = encoder.encode(file.content), header = new Uint8Array(512);
    const separator = path.lastIndexOf('/');
    write(header, 0, 100, path.slice(separator + 1)); write(header, 345, 155, path.slice(0, separator));
    write(header, 100, 8, '0000644\0'); write(header, 108, 8, '0000000\0'); write(header, 116, 8, '0000000\0');
    write(header, 124, 12, bytes.length.toString(8).padStart(11, '0') + '\0'); write(header, 136, 12, '00000000000\0');
    header.fill(32, 148, 156); header[156] = 48;
    write(header, 257, 6, 'ustar\0'); write(header, 263, 2, '00');
    write(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
    total += bytes.length; if (total > 25_000_000) throw new Error('Das Chart überschreitet die Exportgröße von 25 MB. Bitte weniger Dateien auswählen.');
  }
  chunks.push(new Uint8Array(1024));
  const stream = new Blob(chunks).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${chart.name}-${chart.version}.tgz`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
