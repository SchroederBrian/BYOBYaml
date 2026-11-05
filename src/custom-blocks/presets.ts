import { designerBlocks, makeParameter, CUSTOM_FORMAT, type CustomBlockDefinition, type RecipeNode } from './model';

function node(type: string, fields: Record<string, any> = {}): RecipeNode {
  const spec = designerBlocks.find((spec) => spec.type === type)!;
  return { id: crypto.randomUUID(), type, fields: Object.fromEntries((spec.args ?? []).map((arg) => [arg.name, fields[arg.name] ?? (arg.kind === 'dd' ? arg.options[0][1] || '__none__' : arg.kind === 'chk' ? arg.value ? 'TRUE' : 'FALSE' : String(arg.value))])) };
}
export function newDefinition(kind: 'compose' | 'k8s', type = kind === 'compose' ? 'compose_service' : 'k8s_deployment'): CustomBlockDefinition {
  const root = node(type);
  const spec = designerBlocks.find((spec) => spec.type === type)!;
  const definition: CustomBlockDefinition = { format: CUSTOM_FORMAT, version: 1, id: crypto.randomUUID(), revision: 0, kind, name: 'Neuer Block', description: '', color: kind === 'compose' ? '#7a68d4' : '#c08a1e', archived: false, root, parameters: [], bindings: [] };
  const expose = (target: RecipeNode, field: string) => {
    const arg = designerBlocks.find((spec) => spec.type === target.type)?.args?.find((arg) => arg.name === field);
    if (!arg) return;
    const parameter = makeParameter(target, arg);
    definition.parameters.push(parameter); definition.bindings.push({ blockId: target.id, field, parameterId: parameter.id });
  };
  expose(root, spec.args?.[0]?.name ?? '');
  if (spec.args?.some((arg) => arg.name === 'IMAGE')) expose(root, 'IMAGE');
  if (['k8s_deployment','k8s_statefulset','k8s_daemonset','k8s_job','k8s_cronjob'].includes(type)) {
    const container = node('pod_container'); root.next = { block: container }; expose(container, 'IMAGE');
    if (spec.args?.some((arg) => arg.name === 'REPLICAS')) expose(root, 'REPLICAS');
  }
  if (type === 'compose_file') {
    const service = node('compose_service'); root.next = { block: service }; expose(service, 'NAME'); expose(service, 'IMAGE');
  }
  if (type === 'k8s_service') root.next = { block: node('svc_k8s_port') };
  if (type === 'k8s_ingress') root.next = { block: node('ingress_rule') };
  if (type === 'k8s_hpa') root.next = { block: node('hpa_metric') };
  return definition;
}
