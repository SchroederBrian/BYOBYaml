import * as Blockly from 'blockly/core';
import { generate } from './blocks/generator';
import { registerBlocks } from './blocks/register';
import type { ProjectFile } from './project';

/** Generate in an isolated workspace without replacing the file currently being edited. */
export function yamlForFile(file: ProjectFile, vars: Record<string, string>): string {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    Blockly.serialization.workspaces.load(file.state, workspace);
    const result = generate(workspace, vars, { fileKind:file.kind, passThroughUnknownVars: file.kind === 'compose' });
    if (result.blocked) throw new Error(result.warnings[0]?.msg ?? 'Eigene Blöcke zuerst korrigieren.');
    return result.yaml;
  } finally {
    Blockly.Events.enable();
    workspace.dispose();
  }
}
