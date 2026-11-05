import { ALL_BLOCKS, SPEC_BY_TYPE } from '../blocks/defs';
import type { ArgDef, BlockSpec } from '../blocks/types';

export const CUSTOM_BLOCK = 'byob_custom';
export const CUSTOM_FORMAT = 'byobyaml-custom-block';
export type ParameterKind = 'text' | 'multiline' | 'integer' | 'number' | 'boolean' | 'select';
export interface CustomParameter { id: string; label: string; kind: ParameterKind; value: string | number | boolean; required: boolean; min?: number; max?: number; choices?: string[] }
export interface CustomBinding { blockId: string; field: string; parameterId: string }
export interface RecipeNode { id: string; type: string; fields: Record<string, any>; next?: { block: RecipeNode }; inputs?: { BODY: { block: RecipeNode } }; x?: number; y?: number }
export interface CustomBlockDefinition { format: typeof CUSTOM_FORMAT; version: 1; id: string; revision: number; kind: 'compose' | 'k8s'; name: string; description: string; color: string; archived: boolean; root: RecipeNode; parameters: CustomParameter[]; bindings: CustomBinding[] }
export interface CustomLibrary { version: 1; revision: number; blocks: CustomBlockDefinition[] }
export interface DesignIssue { message: string; blockId?: string; parameterId?: string; path?: string }

const denied = new Set(['compose_extension', 'k8s_deploymentconfig', 'k8s_route', 'k8s_imagestream', 'k8s_buildconfig', 'k8s_custom', 'k8s_template', 'meta_image_trigger', 'dc_strategy', 'dc_trigger']);
const scopes = new Set(['compose','service','k8s','pod','container','Deployment','StatefulSet','DaemonSet','Job','CronJob','Service','Ingress','ConfigMap','Secret','PersistentVolumeClaim','HorizontalPodAutoscaler','Namespace','ServiceAccount']);
export const designerBlocks = ALL_BLOCKS.filter((spec) => spec.cat !== 'extras' && spec.cat !== 'build' && !denied.has(spec.type) && (!spec.scope || spec.scope.some((scope) => scopes.has(scope))));
const approved = new Map(designerBlocks.map((spec) => [spec.type, spec]));
const forbiddenKey = (value: unknown) => ['__proto__','prototype','constructor'].includes(String(value));
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export const parameterField = (parameterId: string) => `P_${parameterId.replace(/[^A-Za-z0-9_]/g, '_')}`;
export const nativeSpec = (type: string) => approved.get(type);
export function walkRecipe(root: RecipeNode): RecipeNode[] {
  const result: RecipeNode[] = [], pending = [root];
  while (pending.length) { const node = pending.pop()!; result.push(node); if (result.length > 40) throw new Error('Höchstens 40 Bausteine pro eigenem Block.'); if (node.next?.block) pending.push(node.next.block); if (node.inputs?.BODY?.block) pending.push(node.inputs.BODY.block); }
  return result;
}
export function normalizeDefinition(raw: any): CustomBlockDefinition {
  if (!raw || raw.format !== CUSTOM_FORMAT || raw.version !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id ?? '') || !['compose','k8s'].includes(raw.kind)) throw new Error('Keine unterstützte eigene Blockdefinition.');
  if (!text(raw.name, 80) || !raw.name.trim() || !text(raw.description, 600) || !/^#[0-9a-f]{6}$/i.test(raw.color ?? '')) throw new Error('Name, Beschreibung oder Blockfarbe sind ungültig.');
  const ids = new Set<string>();
  let count = 0;
  const node = (value: any, depth = 0): RecipeNode => {
    if (!value || depth > 30 || ++count > 40 || !text(value.id, 100) || !value.id || ids.has(value.id)) throw new Error('Ungültige oder zu große Bausteinstruktur.');
    const spec = approved.get(value.type);
    if (!spec || (raw.kind === 'compose' ? !['compose','service'].includes(spec.cat) : ['compose','service'].includes(spec.cat))) throw new Error('Dieser Baustein ist für den gewählten Blocktyp nicht freigegeben.');
    if (depth && spec.shape === 'hat') throw new Error('Startblöcke dürfen nicht in andere Bausteine eingebettet werden.');
    if (value.disabled || value.enabled === false || value.disabledReasons?.length) throw new Error('Deaktivierte Bausteine zuerst aktivieren oder entfernen.');
    ids.add(value.id);
    const fields: Record<string, any> = Object.create(null);
    for (const [key, supplied] of Object.entries(value.fields ?? {})) {
      const arg = spec.args?.find((arg) => arg.name === key);
      if (!arg || !['string','number','boolean'].includes(typeof supplied) || typeof supplied === 'number' && !Number.isFinite(supplied) || typeof supplied === 'string' && supplied.length > 8000) throw new Error('Ungültiges Bausteinfeld.');
      fields[key] = supplied;
    }
    if (value.inputs && Object.keys(value.inputs).some((key) => key !== 'BODY') || value.inputs?.BODY && spec.shape !== 'c') throw new Error('Dieser Baustein unterstützt diesen inneren Anschluss nicht.');
    return { id: value.id, type: spec.type, fields, ...(value.inputs?.BODY?.block ? { inputs: { BODY: { block: node(value.inputs.BODY.block, depth + 1) } } } : {}), ...(value.next?.block ? { next: { block: node(value.next.block, depth + 1) } } : {}), ...(depth === 0 ? { x: 28, y: 28 } : {}) };
  };
  const root = node(raw.root);
  const nodes = new Map(walkRecipe(root).map((node) => [node.id, node]));
  if (!Array.isArray(raw.parameters) || raw.parameters.length > 40 || !Array.isArray(raw.bindings) || raw.bindings.length > 120) throw new Error('Zu viele oder ungültige Eingabefelder.');
  const parameterIds = new Set<string>();
  const parameters: CustomParameter[] = raw.parameters.map((p: any) => {
    if (!p || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id ?? '') || parameterIds.has(p.id) || !text(p.label, 60) || !p.label.trim() || !['text','multiline','integer','number','boolean','select'].includes(p.kind)) throw new Error('Eingabefelder benötigen eindeutige Kennungen und eine Beschriftung.');
    parameterIds.add(p.id);
    if (!['string','number','boolean'].includes(typeof p.value) || typeof p.value === 'string' && p.value.length > 8000 || typeof p.value === 'number' && !Number.isFinite(p.value)) throw new Error('Ungültiger Standardwert.');
    const choices = p.kind === 'select' ? p.choices : undefined;
    if (p.kind === 'select' && (!Array.isArray(choices) || !choices.length || choices.length > 50 || choices.some((choice: unknown) => !text(choice, 200)) || new Set(choices).size !== choices.length)) throw new Error('Auswahlfelder benötigen 1–50 eindeutige Auswahlwerte.');
    if (p.min !== undefined && !Number.isFinite(p.min) || p.max !== undefined && !Number.isFinite(p.max) || p.min !== undefined && p.max !== undefined && p.min > p.max) throw new Error('Ungültige Mindest- oder Höchstwerte.');
    return { id: p.id, label: p.label.trim(), kind: p.kind, value: p.value, required: !!p.required, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(choices ? { choices: [...choices] } : {}) };
  });
  if (new Set(parameters.map((parameter) => parameterField(parameter.id))).size !== parameters.length) throw new Error('Eingabefeld-Kennungen dürfen sich nicht überschneiden.');
  const bound = new Set<string>();
  const bindings: CustomBinding[] = raw.bindings.map((binding: any) => {
    const native = nodes.get(binding?.blockId), arg = native && approved.get(native.type)?.args?.find((arg) => arg.name === binding.field);
    const parameter = parameters.find((p) => p.id === binding?.parameterId), key = JSON.stringify([binding?.blockId, binding?.field]);
    if (!arg || !parameter || bound.has(key)) throw new Error('Ein Eingabefeld verweist auf einen fehlenden oder doppelt belegten Anschluss.');
    if (arg.kind === 'chk' && parameter.kind !== 'boolean') throw new Error(`${parameter.label}: Dieses Schaltfeld benötigt einen Wahr/Falsch-Wert.`);
    if (arg.kind === 'dd' && (parameter.kind !== 'select' || parameter.choices?.some((choice) => !arg.options.some(([, value]) => value === choice)))) throw new Error(`${parameter.label}: Nur die vorgegebenen Auswahlwerte des Bausteins sind erlaubt.`);
    if (arg.kind === 'num' && (!['number','integer'].includes(parameter.kind) || arg.precision === 1 && parameter.kind !== 'integer' || arg.min !== undefined && (parameter.min === undefined || parameter.min < arg.min))) throw new Error(`${parameter.label}: Der Zahlenbereich muss zum Baustein passen.`);
    bound.add(key); return { blockId: binding.blockId, field: binding.field, parameterId: parameter.id };
  });
  if (parameters.some((p) => !bindings.some((binding) => binding.parameterId === p.id))) throw new Error('Jedes sichtbare Eingabefeld muss mit einem Bausteinfeld verbunden sein.');
  return { format: CUSTOM_FORMAT, version: 1, id: raw.id, revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0, kind: raw.kind, name: raw.name.trim(), description: raw.description, color: raw.color.toLowerCase(), archived: !!raw.archived, root, parameters, bindings };
}
export function coerceArgument(arg: ArgDef, supplied: unknown, allowMarkers = false): any {
  const fallback = arg.kind === 'dd' ? arg.options[0][1] : arg.kind === 'chk' ? arg.value : arg.value;
  const value = supplied ?? fallback;
  if (allowMarkers && typeof value === 'string' && /BYOBHELMVAR\d+TOKEN/.test(value)) return value;
  if (arg.kind === 'chk') return value === true || value === 'TRUE' || value === 'true';
  if (arg.kind === 'dd') { const result = value === '__none__' ? '' : String(value); if (!arg.options.some(([, option]) => option === result)) throw new Error(`Ungültiger Auswahlwert für ${arg.name}.`); return result; }
  if (arg.kind === 'num') { const result = Number(value); if (String(value).trim() === '' || !Number.isFinite(result) || arg.precision === 1 && !Number.isInteger(result) || arg.min !== undefined && result < arg.min) throw new Error(`Ungültiger Zahlenwert für ${arg.name}.`); return result; }
  if (['K','KEY','NAME'].includes(arg.name) && forbiddenKey(value)) throw new Error('Dieser Schlüssel ist reserviert.');
  return String(value);
}
export function parameterValue(parameter: CustomParameter, raw: unknown, allowMarkers = false): any {
  const value = raw ?? parameter.value;
  if (allowMarkers && typeof value === 'string' && /BYOBHELMVAR\d+TOKEN/.test(value)) return value;
  if (parameter.kind === 'boolean') { if (![true,false,'TRUE','FALSE','true','false'].includes(value as any)) throw new Error(`${parameter.label}: Bitte Wahr oder Falsch wählen.`); return value === true || value === 'TRUE' || value === 'true'; }
  if (parameter.kind === 'number' || parameter.kind === 'integer') {
    const number = Number(value);
    if (String(value).trim() === '' || !Number.isFinite(number) || parameter.kind === 'integer' && !Number.isInteger(number) || parameter.min !== undefined && number < parameter.min || parameter.max !== undefined && number > parameter.max) throw new Error(`${parameter.label}: Bitte einen gültigen ${parameter.kind === 'integer' ? 'ganzzahligen ' : ''}Wert${parameter.min !== undefined ? ` ab ${parameter.min}` : ''}${parameter.max !== undefined ? ` bis ${parameter.max}` : ''} angeben.`);
    return number;
  }
  const string = String(value);
  if (string.length > 8000 || parameter.required && !string.trim() || parameter.kind === 'select' && !parameter.choices?.includes(string === '__none__' ? '' : string)) throw new Error(`${parameter.label}: Bitte einen gültigen Wert angeben.`);
  return string === '__none__' && parameter.kind === 'select' ? '' : string;
}
export function makeParameter(node: RecipeNode, arg: ArgDef): CustomParameter {
  const kind: ParameterKind = arg.kind === 'chk' ? 'boolean' : arg.kind === 'dd' ? 'select' : arg.kind === 'num' ? arg.precision === 1 ? 'integer' : 'number' : arg.kind === 'multi' ? 'multiline' : 'text';
  const value = coerceArgument(arg, node.fields[arg.name]);
  return { id: crypto.randomUUID(), label: arg.name === 'NAME' ? 'Name' : arg.name === 'IMAGE' ? 'Image' : arg.name === 'REPLICAS' ? 'Replicas' : arg.name, kind, value, required: typeof value === 'string' && !!value, ...(arg.kind === 'num' && arg.min !== undefined ? { min: arg.min } : {}), ...(arg.kind === 'dd' ? { choices: arg.options.map(([, value]) => value) } : {}) };
}
export function definitionArgs(definition: CustomBlockDefinition): ArgDef[] {
  return definition.parameters.map((p) => {
    const name = parameterField(p.id);
    if (p.kind === 'boolean') return { kind: 'chk', name, value: parameterValue(p, p.value) };
    if (p.kind === 'select') return { kind: 'dd', name, options: p.choices!.map((choice) => [choice || 'Standard', choice]) };
    if (p.kind === 'integer' || p.kind === 'number') return { kind: 'num', name, value: Number(p.value), min: p.min, precision: p.kind === 'integer' ? 1 : undefined };
    return { kind: p.kind === 'multiline' ? 'multi' : 'text', name, value: String(p.value) };
  });
}
export function definitionSpec(definition: CustomBlockDefinition): BlockSpec {
  const root = SPEC_BY_TYPE[definition.root.type];
  const literal = (value: string) => value.replace(/%/g, '%%');
  return { type: CUSTOM_BLOCK, cat: 'extras', shape: root.shape, msg: [literal(definition.name), ...definition.parameters.map((p, index) => `${literal(p.label)} %${index + 1}`)].join(' · '), args: definitionArgs(definition), scope: root.scope, where: root.where, tip: definition.description, gen: () => { throw new Error('Eigene Blöcke müssen vor der Ausgabe validiert und in ihre Bausteine aufgelöst werden.'); } };
}

/** Canonicalize embedded definitions without changing workspace coordinates or field values. */
export function normalizeCustomSnapshots(state: any): any {
  const pending: any[] = [...(state?.blocks?.blocks ?? []), ...(state?.type ? [state] : [])];
  let count = 0;
  while (pending.length) {
    if (++count > 20000) throw new Error('Die importierte Blockstruktur ist zu groß.');
    const node = pending.pop();
    if (node?.type === CUSTOM_BLOCK) node.extraState = { definition: normalizeDefinition(node.extraState?.definition) };
    if (node?.next?.block) pending.push(node.next.block);
    for (const input of Object.values(node?.inputs ?? {}) as any[]) if (input?.block) pending.push(input.block);
  }
  return state;
}
