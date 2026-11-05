// Walks the block stacks of a workspace and produces YAML.
import * as Blockly from 'blockly/core';
import YAML, { isScalar, Scalar } from 'yaml';
import { SPEC_BY_TYPE } from './defs';
import { readValues } from './register';
import { Ctx } from './types';
import { CUSTOM_BLOCK } from '../custom-blocks/model';
import { cleanOutput, expandCustomState } from '../custom-blocks/recipe';
import { customBlockAccess, customValidation } from '../custom-blocks/runtime';
import { generateDockerfile } from '../dockerfile';
import type { FileKind } from '../project';

export interface GenWarning {
  blockId: string;
  msg: string;
}

export interface GenResult {
  yaml: string;
  docs: number;
  warnings: GenWarning[];
  blocked?: boolean;
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
  fileKind?: FileKind;
  /** Docker Compose resolves ${X}, ${X:-default}, ${X:?msg} itself: keep unknown ones literally, no warning. */
  passThroughUnknownVars?: boolean;
  /** Internal Helm export: placeholder scalars are validated after rendering. */
  templateMode?: boolean;
  validateDocument?: (document: any, rootId: string) => string[];
}

export function generate(ws: Blockly.Workspace, vars: Record<string, string> = {}, opts: GenOptions = {}): GenResult {
  if (opts.fileKind === 'dockerfile') return generateDockerfile(ws, vars);
  const custom = ws.getAllBlocks(false).filter((block) => block.type === CUSTOM_BLOCK);
  if (custom.length) {
    const failed = (message: string): GenResult => {
      const warnings = custom.map((block) => ({ blockId: block.id, msg: message }));
      custom.forEach((block) => setWarning(block, message));
      return { yaml: '', docs: 0, warnings, blocked: true };
    };
    if (!customBlockAccess()) return failed('Eigene Blocktypen sind nur für angemeldete Nutzer verfügbar.');
    const validator = customValidation();
    if (!validator) return failed('Die Prüfung eigener Blocktypen wird geladen. Bitte kurz warten.');
    const expandedWorkspace = new Blockly.Workspace();
    try {
      Blockly.Events.disable();
      const expanded = expandCustomState(Blockly.serialization.workspaces.save(ws), vars, !!opts.templateMode);
      Blockly.serialization.workspaces.load(expanded.state, expandedWorkspace);
      const result = generate(expandedWorkspace, vars, { ...opts, validateDocument: opts.templateMode ? undefined : (doc, rootId) => expanded.affectedRoots.has(rootId) ? validator.validateDocument(cleanOutput(doc)).map((issue) => `${issue.path ?? '/'}: ${issue.message}`) : [] });
      const warnings = result.warnings.map((warning) => ({ ...warning, blockId: expanded.owners.get(warning.blockId) ?? expanded.affectedRoots.get(warning.blockId) ?? warning.blockId }));
      for (const block of ws.getAllBlocks(false)) setWarning(block, warnings.filter((warning) => warning.blockId === block.id).map((warning) => warning.msg).join('\n') || null);
      return { ...result, warnings, blocked: result.blocked || result.warnings.some((warning) => expanded.owners.has(warning.blockId) && !(opts.templateMode && /BYOBHELMVAR\d+TOKEN/.test(warning.msg))) };
    } catch (error) { return failed(error instanceof Error ? error.message : 'Der eigene Block konnte nicht geprüft werden.'); }
    finally { Blockly.Events.enable(); expandedWorkspace.dispose(); }
  }
  const warnings: GenWarning[] = [];
  const out: any[] = [];
  const sources: string[] = [];
  let blocked = false;
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
  // OpenShift templates reference their parameters as ${NAME} / ${{NAME}}
  if (tops.some((t) => t.type === 'k8s_template')) opts = { ...opts, passThroughUnknownVars: true };
  for (const top of tops) {
    const spec = SPEC_BY_TYPE[top.type];
    if (spec?.shape === 'hat' && top.isEnabled()) {
      runBlock(top, { scopes: new Set(), out, doc: null, target: null, warn: () => {} });
      while (sources.length < out.length) sources.push(top.id);
    }
  }
  // Loose blocks that are not attached to a start block: clear their warning, mark lightly.
  for (const b of ws.getAllBlocks(false)) {
    if (!touched.has(b.id)) setWarning(b, null);
  }

  // a Template start block collects every other document of the file as its objects
  let docs = out.map(prune);
  if (opts.validateDocument) for (let index = 0; index < docs.length; index++) {
    const errors = opts.validateDocument(docs[index], sources[index]);
    if (errors.length) { blocked = true; errors.forEach((msg) => warnings.push({ blockId: sources[index], msg })); }
  }
  const tplIdx = docs.findIndex((d) => d && d.__template);
  if (tplIdx >= 0) {
    const tpl = docs[tplIdx];
    tpl.objects = docs.filter((_, i) => i !== tplIdx);
    delete tpl.__template;
    docs = [tpl];
  }
  docs = docs.map((d) => octalModes(d));
  // version 1.1 quoting: strings like no/yes/on/y/1:20 get quotes, so YAML 1.1 parsers
  // (kubectl/oc via go-yaml v2) do not turn them into booleans or numbers
  const yaml = docs
    .map((d) => YAML.stringify(d, { version: '1.1', lineWidth: 0, nullStr: '', indentSeq: true, aliasDuplicateObjects: false }))
    .join('---\n');
  return { yaml, docs: docs.length, warnings, ...(blocked ? { blocked: true } : {}) };
}

const OCTAL_KEYS = new Set(['defaultMode', 'mode']);
/** file permissions are written as 0755 (octal) instead of 493 */
function octalModes(v: any, key?: string): any {
  if (isScalar(v)) return v;
  if (typeof v === 'number' && key && OCTAL_KEYS.has(key) && Number.isInteger(v) && v >= 0 && v <= 0o7777) {
    const s = new Scalar(v);
    s.format = 'OCT';
    return s;
  }
  if (Array.isArray(v)) return v.map((x) => octalModes(x));
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = octalModes(v[k], k);
  }
  return v;
}

function setWarning(b: Blockly.Block, text: string | null) {
  const bs = b as Blockly.BlockSvg;
  if (typeof bs.setWarningText !== 'function') return;
  const cur = bs.getIcon?.(Blockly.icons.IconType.WARNING) as any;
  const curText = cur?.getText?.() ?? null;
  if ((curText || null) === (text || null)) return;
  bs.setWarningText(text);
}
