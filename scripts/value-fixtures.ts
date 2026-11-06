// Shared fixtures for the value-block golden tests: every demo file and built-in snippet.
import * as Blockly from 'blockly/core';
import { generate } from '../src/blocks/generator';
import { registerBlocks } from '../src/blocks/register';
import { composeDemo, openshiftDemo } from '../src/examples';
import { resolveVariables, wsState } from '../src/project';
import type { ProjectFile } from '../src/project';
import { BUILTIN_SNIPPETS, snippetState } from '../src/snippets';
import { SPEC_BY_TYPE } from '../src/blocks/defs';

export interface Case { name: string; file: ProjectFile; vars: Record<string, string> }

export function goldenCases(): Case[] {
  const cases: Case[] = [];
  for (const project of [openshiftDemo(), composeDemo()]) {
    for (const f of project.files) cases.push({ name: `${project.title}__${f.name}`, file: f, vars: resolveVariables(project, f) });
  }
  for (const s of BUILTIN_SNIPPETS) {
    cases.push({ name: `snippet__${s.id}`, file: { id: s.id, name: s.name, kind: s.kind, state: wsState(snippetState(s)) } as ProjectFile, vars: {} });
  }
  return cases;
}

/** Run generate() on a file's state with the given loader. */
export function runCase(c: Case, read: (block: Blockly.Block, name: string) => any = (block, name) => block.getFieldValue(name), load: (state: any, ws: Blockly.Workspace) => void = (state, ws) => { Blockly.serialization.workspaces.load(state, ws); }) {
  registerBlocks();
  const ws = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    load(c.file.state, ws);
    const r = generate(ws, c.vars, { fileKind: c.file.kind, passThroughUnknownVars: c.file.kind === 'compose' });
    const values = ws.getAllBlocks(true).flatMap((b) => (SPEC_BY_TYPE[b.type]?.args ?? []).map((a) => `${b.type}.${a.name}=${JSON.stringify(read(b, a.name))}`));
    return { values, yaml: r.yaml, docs: r.docs, blocked: !!r.blocked, warnings: r.warnings.map((w) => w.msg) };
  } finally {
    Blockly.Events.enable();
    ws.dispose();
  }
}
