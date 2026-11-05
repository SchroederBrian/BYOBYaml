import YAML, { isScalar } from 'yaml';
import { SPEC_BY_TYPE } from '../blocks/defs';
import type { Ctx } from '../blocks/types';
import { CUSTOM_BLOCK, coerceArgument, normalizeDefinition, parameterField, parameterValue, walkRecipe, type CustomBlockDefinition, type DesignIssue, type RecipeNode } from './model';

export function instantiateRecipe(definition: CustomBlockDefinition, fields: Record<string, any>, vars: Record<string, string> = {}, templateMode = false, preserveVariables = false): RecipeNode {
  const root: RecipeNode = structuredClone(definition.root);
  const values = new Map<string, any>();
  for (const parameter of definition.parameters) {
    const raw = fields[parameterField(parameter.id)] ?? parameter.value;
    const resolved = typeof raw === 'string' ? raw.replace(/\$\{([A-Za-z_][\w.-]*)\}/g, (match, name) => Object.hasOwn(vars, name) ? vars[name] : match) : raw;
    const unresolved = preserveVariables && typeof resolved === 'string' && /\$\{[A-Za-z_][\w.-]*\}/.test(resolved);
    const normalized = parameterValue(parameter, unresolved ? parameter.value : resolved, templateMode);
    values.set(parameter.id, typeof raw === 'string' && /\$\{|BYOBHELMVAR\d+TOKEN/.test(raw) ? raw : normalized);
  }
  const nodes = new Map(walkRecipe(root).map((node) => [node.id, node]));
  for (const binding of definition.bindings) nodes.get(binding.blockId)!.fields[binding.field] = values.get(binding.parameterId);
  for (const node of nodes.values()) for (const arg of SPEC_BY_TYPE[node.type].args ?? []) {
    const raw = node.fields[arg.name];
    const resolved = typeof raw === 'string' ? raw.replace(/\$\{([A-Za-z_][\w.-]*)\}/g, (match, name) => Object.hasOwn(vars, name) ? vars[name] : match) : raw;
    if (!(preserveVariables && typeof resolved === 'string' && /\$\{[A-Za-z_][\w.-]*\}/.test(resolved))) coerceArgument(arg, resolved, templateMode);
  }
  return root;
}

export function expandCustomState(state: any, vars: Record<string, string> = {}, templateMode = false, preserveVariables = false) {
  const copy = structuredClone(state);
  const owners = new Map<string, string>(), affectedRoots = new Map<string, string>();
  let serial = 0;
  const tail = (node: any) => { let last = node; while (last.next?.block) last = last.next.block; return last; };
  const append = (node: any, child: any) => { if (child) tail(node).next = { block: child }; };
  const visit = (node: any, rootId: string, depth = 0): any => {
    if (!node) return node;
    if (depth > 100 || ++serial > 10000) throw new Error('Die Blockstruktur ist zu groß.');
    if (node.type === CUSTOM_BLOCK) {
      const definition = normalizeDefinition(node.extraState?.definition);
      const disabled = !!node.disabled || node.enabled === false || !!node.disabledReasons?.length;
      const recipe = instantiateRecipe(definition, disabled ? {} : node.fields ?? {}, vars, templateMode, preserveVariables);
      const instanceId = String(node.id || `custom-${serial}`);
      affectedRoots.set(rootId, instanceId);
      const nodes = walkRecipe(recipe);
      nodes.forEach((child, index) => { child.id = index === 0 ? instanceId : `${instanceId}:recipe:${index}`; if (disabled) (child as any).disabledReasons = ['byob-disabled-macro']; owners.set(child.id, instanceId); });
      const spec = SPEC_BY_TYPE[recipe.type];
      if (spec.shape === 'hat') append(recipe, visit(node.next?.block, rootId, depth + 1));
      else {
        if (spec.shape === 'c' && node.inputs?.BODY?.block) {
          const body = visit(node.inputs.BODY.block, rootId, depth + 1);
          if (recipe.inputs?.BODY?.block) append(recipe.inputs.BODY.block, body); else recipe.inputs = { BODY: { block: body } };
        }
        append(recipe, visit(node.next?.block, rootId, depth + 1));
      }
      recipe.x = node.x ?? 28; recipe.y = node.y ?? 28;
      return recipe;
    }
    for (const input of Object.values(node.inputs ?? {}) as any[]) if (input.block) input.block = visit(input.block, rootId, depth + 1);
    if (node.next?.block) node.next.block = visit(node.next.block, rootId, depth + 1);
    return node;
  };
  for (let index = 0; index < (copy.blocks?.blocks?.length ?? 0); index++) {
    const root = copy.blocks.blocks[index];
    copy.blocks.blocks[index] = visit(root, String(root.id));
  }
  return { state: copy, owners, affectedRoots };
}

export function hasCustomBlocks(state: any): boolean {
  const pending: any[] = [...(state?.blocks?.blocks ?? []), ...(state?.type ? [state] : [])];
  let count = 0;
  while (pending.length && count++ < 20000) {
    const node = pending.pop();
    if (node?.type === CUSTOM_BLOCK) return true;
    if (node?.next?.block) pending.push(node.next.block);
    for (const input of Object.values(node?.inputs ?? {}) as any[]) if (input?.block) pending.push(input.block);
  }
  return false;
}

export function cleanOutput(value: any): any {
  if (isScalar(value)) return value.value;
  if (Array.isArray(value)) return value.map(cleanOutput).filter((item) => item !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, cleanOutput(item)]));
  return value;
}

function fixture(type: string, kind: 'compose' | 'k8s'): { ctx: Ctx; hint: string } {
  const spec = SPEC_BY_TYPE[type];
  const ctx: Ctx = { scopes: new Set(), out: [], doc: null, target: null, warn: () => {} };
  if (spec.shape === 'hat') return { ctx, hint: 'Eigenständige Ressource / Datei' };
  if (kind === 'compose') {
    const service = { image: 'nginx:alpine' };
    ctx.doc = { services: { beispiel: service } }; ctx.out.push(ctx.doc);
    ctx.scopes = new Set(['compose', ...(spec.scope?.includes('service') ? ['service'] : [])]);
    ctx.target = spec.scope?.includes('service') ? service : ctx.doc;
    return { ctx, hint: spec.scope?.includes('service') ? 'Compose-Service „beispiel“' : 'Compose-Datei' };
  }
  const specific = spec.scope?.find((scope) => !['k8s','pod','container'].includes(scope)) ?? 'Deployment';
  const resource = ['StatefulSet','DaemonSet','Job','CronJob','ConfigMap','Secret','PersistentVolumeClaim','Service','Ingress','HorizontalPodAutoscaler','Namespace','ServiceAccount'].includes(specific) ? specific : 'Deployment';
  const doc: any = { apiVersion: ['Deployment','StatefulSet','DaemonSet'].includes(resource) ? 'apps/v1' : ['Job','CronJob'].includes(resource) ? 'batch/v1' : resource === 'Ingress' ? 'networking.k8s.io/v1' : resource === 'HorizontalPodAutoscaler' ? 'autoscaling/v2' : 'v1', kind: resource, metadata: { name: 'beispiel' } };
  if (['Deployment','StatefulSet','DaemonSet','Job','CronJob'].includes(resource)) {
    const container = { name: 'app', image: 'nginx:alpine' }, pod = { containers: [container] }, meta = { labels: { app: 'beispiel' } };
    doc.spec = { replicas: 1, selector: { matchLabels: { app: 'beispiel' } }, template: { metadata: meta, spec: pod } };
    if (resource === 'StatefulSet') doc.spec.serviceName = 'beispiel';
    if (resource === 'DaemonSet') delete doc.spec.replicas;
    if (resource === 'Job' || resource === 'CronJob') { delete doc.spec.replicas; delete doc.spec.selector; (pod as any).restartPolicy = 'OnFailure'; }
    if (resource === 'CronJob') doc.spec = { schedule: '0 * * * *', jobTemplate: { spec: doc.spec } };
    Object.assign(ctx, { pod, podMeta: meta, container });
    ctx.scopes = new Set(['k8s',resource,'pod', ...(spec.scope?.includes('container') ? ['container'] : [])]);
    ctx.target = spec.scope?.includes('container') ? container : doc;
  } else {
    ctx.scopes = new Set(['k8s', resource]); ctx.target = doc;
    if (resource === 'ConfigMap') doc.data = {};
    if (resource === 'Secret') { doc.type = 'Opaque'; doc.stringData = {}; doc.data = {}; }
    if (resource === 'PersistentVolumeClaim') doc.spec = { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } };
    if (resource === 'Service') doc.spec = { selector: { app: 'beispiel' }, ports: [{ port: 80, targetPort: 80 }] };
    if (resource === 'Ingress') doc.spec = { defaultBackend: { service: { name: 'beispiel', port: { number: 80 } } }, rules: [], tls: [] };
    if (resource === 'HorizontalPodAutoscaler') doc.spec = { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'beispiel' }, minReplicas: 1, maxReplicas: 3, metrics: [] };
  }
  ctx.doc = doc; ctx.out.push(doc);
  return { ctx, hint: `Kubernetes ${resource}${spec.scope?.includes('container') ? ' · Container' : spec.scope?.includes('pod') ? ' · Pod' : ''}` };
}

export function previewRecipe(definition: CustomBlockDefinition) {
  const instantiated = instantiateRecipe(definition, {});
  const { ctx, hint } = fixture(instantiated.type, definition.kind), issues: DesignIssue[] = [];
  const run = (start: RecipeNode | undefined, context: Ctx) => {
    for (let node = start; node; node = node.next?.block) {
      const spec = SPEC_BY_TYPE[node.type];
      const current = node;
      if (spec.scope && !spec.scope.some((scope) => context.scopes.has(scope))) { issues.push({ blockId: node.id, message: `Dieser Baustein gehört ${spec.where ?? 'in einen anderen Bereich'}.` }); continue; }
      try {
        const values = Object.fromEntries((spec.args ?? []).map((arg) => {
          const raw = node!.fields[arg.name];
          if (typeof raw === 'string' && /\$\{/.test(raw)) throw new Error('Für die Definition gültige Beispielwerte verwenden. Variablen können später in sichtbaren Eingabefeldern eingesetzt werden.');
          return [arg.name, coerceArgument(arg, raw)];
        }));
        const local: Ctx = { ...context, warn: (message) => issues.push({ blockId: current.id, message }) };
        spec.gen(values, local, (scopes, patch) => run(spec.shape === 'hat' ? current.next?.block : current.inputs?.BODY?.block, { ...local, ...patch, scopes: new Set([...local.scopes, ...scopes]) }));
      } catch (error) { issues.push({ blockId: current.id, message: error instanceof Error ? error.message : 'Baustein konnte nicht erzeugt werden.' }); }
      if (spec.shape === 'hat') break;
    }
  };
  run(instantiated, ctx);
  const documents = ctx.out.map(cleanOutput);
  return { documents, hint, issues, yaml: documents.map((doc) => YAML.stringify(doc, { version: '1.1', lineWidth: 0, aliasDuplicateObjects: false })).join('---\n') };
}
