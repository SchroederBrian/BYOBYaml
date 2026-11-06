import * as Blockly from 'blockly/core';
import { generate } from './blocks/generator';
import { registerBlocks } from './blocks/register';
import { loadState, type ValueSession } from './blocks/value';
import type { ProjectFile } from './project';

/** Generate in an isolated workspace without replacing the file currently being edited. */
/** `session`: the seed and clock of one export; files of one export share it. Without one, every call draws fresh random values. */
export function yamlForFile(file: ProjectFile, vars: Record<string, string>, session?: ValueSession): string {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    loadState(file.state, workspace);
    const result = generate(workspace, vars, { fileKind:file.kind, passThroughUnknownVars: file.kind === 'compose', session: session && { ...session, fileName: file.name } });
    if (result.blocked) throw new Error(result.warnings[0]?.msg ?? 'Eigene Blöcke zuerst korrigieren.');
    return result.yaml;
  } finally {
    Blockly.Events.enable();
    workspace.dispose();
  }
}
