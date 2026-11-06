// Value slots: every text/number argument is a socket holding a shadow literal block.
// A real value block dropped on the socket replaces the literal (Scratch-style reporters).
import * as Blockly from 'blockly/core';
import { SPEC_BY_TYPE } from './defs';
import type { ArgDef } from './types';
import { isNativeImageField } from '../registry/editor';
import { CUSTOM_BLOCK } from '../custom-blocks/model';
import { mulberry32, freshSeed, hashText } from './rng';
import { VALUE_BY_TYPE } from './values';
import { LITERAL_TYPES, SHADOW_IMAGE, SHADOW_NUM, SHADOW_TEXT, slotFields } from './slots';

/** Connection type check shared by every value block and shadow literal. */
export const VALUE_CHECK = 'Value';
export { SHADOW_TEXT, SHADOW_NUM, SHADOW_IMAGE, LITERAL_TYPES, slotFields };
const SHADOWS = LITERAL_TYPES;

/** Everything an export run shares: one seed, one clock, one set of names. */
export interface ValueSession {
  seed: number;
  now: Date;
  envName: string;
  projectName: string;
  fileName: string;
  /** Shared by every file of one export (so ports can count up and a password can be reused). Without them each generate() starts empty. */
  counters?: Map<string, number>;
  memo?: Map<string, string | number>;
}

export interface EvalEnv {
  vars: Record<string, string>;
  session: ValueSession;
  /** Unknown ${VARS} stay as text (Compose, OpenShift templates) instead of being an error. */
  passThrough: boolean;
  rng: () => number;
  counters: Map<string, number>;
  memo: Map<string, string | number>;
  warn: (message: string, block: Blockly.Block) => void;
}

/** A session with a fresh seed and the current time: what one export uses. */
export function newSession(info: Partial<Pick<ValueSession, 'envName' | 'projectName' | 'fileName'>> = {}): ValueSession {
  return { seed: freshSeed(), now: new Date(), envName: '', projectName: '', fileName: '', counters: new Map(), memo: new Map(), ...info };
}

export function makeEnv(vars: Record<string, string>, session: ValueSession, warn: EvalEnv['warn'], passThrough = false): EvalEnv {
  return { vars, session, passThrough, rng: mulberry32(session.seed ^ hashText(session.fileName)), counters: session.counters ?? new Map(), memo: session.memo ?? new Map(), warn };
}

/** Does this argument render as a value socket? (custom block parameters stay plain fields) */
export const isSlot = (type: string, arg: ArgDef): boolean => type !== CUSTOM_BLOCK && (arg.kind === 'text' || arg.kind === 'num');

export function shadowType(type: string, arg: ArgDef): string {
  if (arg.kind === 'num') return SHADOW_NUM;
  return isNativeImageField(type, arg.name) ? SHADOW_IMAGE : SHADOW_TEXT;
}

/** Blockly JSON for the three literal block types. */
export function shadowBlockJson(): any[] {
  const literal = (type: string, fieldType: string) => ({
    type,
    message0: '%1',
    args0: [{ type: fieldType, name: 'VALUE', text: '', spellcheck: false }],
    output: VALUE_CHECK,
    style: 'extras_blocks',
  });
  return [literal(SHADOW_TEXT, 'field_input'), literal(SHADOW_NUM, 'field_input'), literal(SHADOW_IMAGE, 'field_registry_image')];
}

/** Extension: give every slot of a freshly created block its default shadow literal. */
export function registerSlotExtension() {
  if (Blockly.Extensions.isRegistered('byob_slots')) return;
  Blockly.Extensions.register('byob_slots', function (this: Blockly.Block) {
    const spec = specOf(this.type);
    if (!spec) return;
    for (const arg of spec.args ?? []) {
      if (!isSlot(this.type, arg)) continue;
      this.getInput(arg.name)?.connection?.setShadowState({ type: shadowType(this.type, arg), fields: { VALUE: String(arg.kind === 'text' || arg.kind === 'num' ? arg.value : '') } });
    }
  });
}

/** Argument list of any block type that has value slots (stack blocks and value blocks). */
const specOf = (type: string): { args?: ArgDef[] } | undefined => SPEC_BY_TYPE[type] ?? VALUE_BY_TYPE[type];

const slotConnection = (block: Blockly.Block, name: string) => block.getInput(name)?.connection ?? null;

/** Used when no export run is active (preview of a single value, tests): a throw-away environment. */
const looseEnv = (): EvalEnv => makeEnv({}, newSession(), () => {});

/** Evaluate any value block (or literal) to a string or number. Problems go to env.warn and give ''. */
export function evalValue(block: Blockly.Block, env: EvalEnv = looseEnv()): string | number {
  if (SHADOWS.has(block.type)) return String(block.getFieldValue('VALUE') ?? '');
  const spec = VALUE_BY_TYPE[block.type];
  if (!spec) {
    env.warn(`Unbekannter Wertblock „${block.type}“.`, block);
    return '';
  }
  try {
    const v: Record<string, any> = {};
    for (const arg of spec.args ?? []) {
      if (arg.kind === 'text') v[arg.name] = String(argValue(block, arg.name, env));
      else if (arg.kind === 'num') {
        const raw = argValue(block, arg.name, env);
        const text = String(raw).trim(), n = Number(text);
        if (text === '' || Number.isNaN(n)) throw new Error(`„${text}“ ist keine Zahl.`);
        v[arg.name] = n;
      } else if (arg.kind === 'chk') v[arg.name] = block.getFieldValue(arg.name) === 'TRUE';
      else v[arg.name] = block.getFieldValue(arg.name);
    }
    return spec.eval(v, env, block);
  } catch (error) {
    env.warn(error instanceof Error ? error.message : String(error), block);
    return '';
  }
}

/** Current value of an argument: shadow literal, evaluated value block, or plain field. */
export function argValue(block: Blockly.Block, name: string, env?: EvalEnv): string | number {
  const connection = slotConnection(block, name);
  if (!connection) return block.getFieldValue(name);
  const target = connection.targetBlock();
  return target ? evalValue(target, env) : '';
}

/** Write an argument's literal text (the shadow stays under any value block). */
export function setArgValue(block: Blockly.Block, name: string, text: string): void {
  const connection = slotConnection(block, name);
  if (!connection) {
    block.setFieldValue(text, name);
    return;
  }
  const target = connection.targetBlock();
  if (target?.isShadow()) target.setFieldValue(text, 'VALUE');
  else {
    const arg = specOf(block.type)?.args?.find((a) => a.name === name);
    connection.setShadowState({ type: arg ? shadowType(block.type, arg) : SHADOW_TEXT, fields: { VALUE: text } });
  }
}

/** Is the slot currently holding a real value block (not just its literal)? */
export function hasValueBlock(block: Blockly.Block, name: string): boolean {
  const target = slotConnection(block, name)?.targetBlock();
  return !!target && !target.isShadow();
}

// ---------- serialized state migration ----------

type ArgSpecs = Record<string, { type: string; args?: ArgDef[] }>;
const ALL_SPECS = (): ArgSpecs => ({ ...SPEC_BY_TYPE, ...VALUE_BY_TYPE });

function upgradeBlock(node: any, specs: ArgSpecs) {
  if (!node || typeof node !== 'object') return;
  const spec = node.type && node.type !== CUSTOM_BLOCK ? specs[node.type] : undefined;
  if (spec && node.fields && typeof node.fields === 'object') {
    for (const arg of spec.args ?? []) {
      if (!isSlot(spec.type, arg) || !(arg.name in node.fields)) continue;
      const value = node.fields[arg.name];
      delete node.fields[arg.name];
      node.inputs ??= {};
      if (!node.inputs[arg.name]) node.inputs[arg.name] = { shadow: { type: shadowType(spec.type, arg), fields: { VALUE: String(value ?? '') } } };
    }
    if (!Object.keys(node.fields).length) delete node.fields;
  }
  for (const input of Object.values<any>(node.inputs ?? {})) {
    upgradeBlock(input?.block, specs);
    upgradeBlock(input?.shadow, specs);
  }
  upgradeBlock(node.next?.block, specs);
}

/** Convert legacy `fields[ARG]` of text/number args into shadow literals. Idempotent; returns a copy. */
export function normalizeState<T>(state: T, specs: ArgSpecs = ALL_SPECS()): T {
  if (!state || typeof state !== 'object') return state;
  const copy: any = structuredClone(state);
  const roots: any[] = Array.isArray(copy?.blocks?.blocks) ? copy.blocks.blocks : copy.type ? [copy] : [];
  for (const root of roots) upgradeBlock(root, specs);
  return copy;
}

/** Load a serialized workspace, upgrading old files on the way in. */
export function loadState(state: any, ws: Blockly.Workspace): void {
  Blockly.serialization.workspaces.load(normalizeState(state), ws);
}

/** Append one serialized block (with its stack) to a workspace, upgrading old data. */
export function appendState(state: any, ws: Blockly.Workspace, opts?: Parameters<typeof Blockly.serialization.blocks.append>[2]): Blockly.Block {
  return Blockly.serialization.blocks.append(normalizeState(state), ws, opts);
}

// ---------- legacy (field-based) form, used by custom block recipes ----------

function downgradeBlock(node: any, specs: ArgSpecs) {
  if (!node || typeof node !== 'object') return;
  const spec = node.type && node.type !== CUSTOM_BLOCK ? specs[node.type] : undefined;
  if (spec && node.inputs) {
    for (const arg of spec.args ?? []) {
      if (!isSlot(spec.type, arg) || !node.inputs[arg.name]) continue;
      const shadow = node.inputs[arg.name].shadow;
      delete node.inputs[arg.name];
      node.fields ??= {};
      node.fields[arg.name] = shadow?.fields?.VALUE ?? String(arg.kind === 'text' || arg.kind === 'num' ? arg.value : '');
    }
    if (!Object.keys(node.inputs).length) delete node.inputs;
  }
  for (const input of Object.values<any>(node.inputs ?? {})) downgradeBlock(input?.block, specs);
  downgradeBlock(node.next?.block, specs);
}

/** Inverse of normalizeState for custom block recipes: shadow literals back to `fields`. Returns a copy. */
export function denormalizeState<T>(state: T, specs: ArgSpecs = ALL_SPECS()): T {
  if (!state || typeof state !== 'object') return state;
  const copy: any = structuredClone(state);
  const roots: any[] = Array.isArray(copy?.blocks?.blocks) ? copy.blocks.blocks : copy.type ? [copy] : [];
  for (const root of roots) downgradeBlock(root, specs);
  return copy;
}

/** Map a field-change event target to the block/argument that owns it (a shadow literal belongs to its parent slot). */
export function ownerOfField(ws: Blockly.Workspace, blockId: string, name: string): { blockId: string; name: string } {
  const block = ws.getBlockById(blockId);
  const input = block?.isShadow() && name === 'VALUE' ? block.outputConnection?.targetConnection?.getParentInput() : null;
  const parent = block?.getParent();
  return input && parent ? { blockId: parent.id, name: input.name } : { blockId, name };
}

/** For a literal block sitting in a slot: the block that owns the slot and the argument name. */
export function slotOwner(literal: Blockly.Block): { block: Blockly.Block; name: string } | null {
  const input = literal.outputConnection?.targetConnection?.getParentInput();
  const parent = literal.getParent();
  return input && parent ? { block: parent, name: input.name } : null;
}
