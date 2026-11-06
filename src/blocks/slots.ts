// Pure helpers over serialized block state (no Blockly import: usable on the server and in analysis code).

export const SHADOW_TEXT = 'byob_text';
export const SHADOW_NUM = 'byob_num';
export const SHADOW_IMAGE = 'byob_image';
/** Literal blocks that sit in every text/number slot by default. */
export const LITERAL_TYPES: ReadonlySet<string> = new Set([SHADOW_TEXT, SHADOW_NUM, SHADOW_IMAGE]);

/**
 * Argument values of a serialized block as flat `{NAME: text}`: its own `fields` plus the literal of every
 * slot that holds no value block. Slots with a value block are computed at export, so they are left out.
 */
export function slotFields(node: any): Record<string, any> {
  const out: Record<string, any> = { ...(node?.fields ?? {}) };
  for (const [name, input] of Object.entries<any>(node?.inputs ?? {})) {
    if (input?.block || !input?.shadow || !LITERAL_TYPES.has(input.shadow.type)) continue;
    out[name] = input.shadow.fields?.VALUE ?? '';
  }
  return out;
}
