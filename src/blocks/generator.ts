// Walks the block stacks of a workspace and produces YAML.
import * as Blockly from 'blockly/core';
import YAML, { isScalar } from 'yaml';
import { SPEC_BY_TYPE } from './defs';
import { readValues } from './register';
import { Ctx } from './types';

export interface GenWarning {
  blockId: string;
  msg: string;
}

export interface GenResult {
  yaml: string;
  docs: number;
  warnings: GenWarning[];
}

/** Remove undefined, empty objects and empty arrays (keeps null on purpose). */
function prune(v: any): any {
  if (isScalar(v)) return v;
  if (Array.isArray(v)) {
    return v.map(prune).filter((x) => x !== undefined);
  }
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      const p = prune(val);
      if (p === undefined) continue;
      if (Array.isArray(p) && p.length === 0) continue;
      if (p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 0 && !KEEP_EMPTY.has(k)) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}
// Keys where an empty object is meaningful.
const KEEP_EMPTY = new Set(['emptyDir', 'imageChange']);

export interface GenOptions {
  /** Docker Compose resolves ${X}, ${X:-default}, ${X:?msg} itself: keep unknown ones literally, no warning. */
  passThroughUnknownVars?: boolean;
}

export function generate(ws: Blockly.Workspace, vars: Record<string, string> = {}, opts: GenOptions = {}): GenResult {
  const warnings: GenWarning[] = [];
  const out: any[] = [];
  const touched = new Set<string>();

  const runChain = (first: Blockly.Block | null, ctx: Ctx) => {
    for (let b = first; b; b = b.getNextBlock()) {
      if (!b.isEnabled()) continue;
      runBlock(b, ctx);
    }
  };

  const runBlock = (b: Blockly.Block, parent: Ctx) => {
    const spec = SPEC_BY_TYPE[b.type];
    if (!spec) return;
    touched.add(b.id);
    const blockWarnings: string[] = [];
    const ctx: Ctx = { ...parent, warn: (m) => blockWarnings.push(m) };

    if (spec.scope && !spec.scope.some((s) => ctx.scopes.has(s))) {
      blockWarnings.push(`Dieser Block gehört ${spec.where ?? 'woanders hin'}.`);
    } else {
      try {
        spec.gen(readValues(b, spec, vars, blockWarnings, !!opts.passThroughUnknownVars), ctx, (scopes, patch) => {
          const child: Ctx = { ...ctx, ...patch, scopes: new Set([...ctx.scopes, ...scopes]) };
          const first = spec.shape === 'hat' ? b.getNextBlock() : b.getInputTargetBlock('BODY');
          runChain(first, child);
        });
      } catch (e: any) {
        blockWarnings.push('Fehler: ' + (e?.message ?? String(e)));
      }
    }
    for (const m of blockWarnings) warnings.push({ blockId: b.id, msg: m });
    setWarning(b, blockWarnings.join('\n') || null);
  };

  const tops = ws.getTopBlocks(true);
  for (const top of tops) {
    const spec = SPEC_BY_TYPE[top.type];
    if (spec?.shape === 'hat' && top.isEnabled()) {
      runBlock(top, { scopes: new Set(), out, doc: null, target: null, warn: () => {} });
    }
  }
  // Loose blocks that are not attached to a start block: clear their warning, mark lightly.
  for (const b of ws.getAllBlocks(false)) {
    if (!touched.has(b.id)) setWarning(b, null);
  }

  const docs = out.map(prune);
  const yaml = docs
    .map((d) => YAML.stringify(d, { lineWidth: 0, nullStr: '', indentSeq: true, aliasDuplicateObjects: false }))
    .join('---\n');
  return { yaml, docs: docs.length, warnings };
}

function setWarning(b: Blockly.Block, text: string | null) {
  const bs = b as Blockly.BlockSvg;
  if (typeof bs.setWarningText !== 'function') return;
  const cur = bs.getIcon?.(Blockly.icons.IconType.WARNING) as any;
  const curText = cur?.getText?.() ?? null;
  if ((curText || null) === (text || null)) return;
  bs.setWarningText(text);
}
