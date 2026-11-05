// Helpers to look at marketplace content without touching the user's editor.
import * as Blockly from 'blockly/core';
import { generate, GenResult } from '../blocks/generator';
import { registerBlocks } from '../blocks/register';
import { SPEC_BY_TYPE } from '../blocks/defs';
import type { FileData, ItemData, ProjectData, SnippetData } from './shared';

export const isSnippet = (d: ItemData): d is SnippetData => !!d && 'block' in d;
export const isProject = (d: ItemData): d is ProjectData => !!d && 'files' in d;
export const isFile = (d: ItemData): d is FileData => !!d && 'state' in d && !('files' in d);

/** Generate YAML for a workspace state in a throw-away headless workspace. */
export function yamlOf(state: any, kind: 'compose' | 'k8s', vars: Record<string, string> = {}): GenResult {
  registerBlocks();
  const ws = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    Blockly.serialization.workspaces.load(state, ws);
    return generate(ws, vars, { passThroughUnknownVars: true });
  } catch (e: any) {
    return { yaml: `# Vorschau nicht möglich: ${e?.message ?? e}`, docs: 0, warnings: [] };
  } finally {
    Blockly.Events.enable();
    ws.dispose();
  }
}

/** A snippet as a one-stack workspace state. */
export function snippetState(d: SnippetData) {
  return { blocks: { languageVersion: 0, blocks: [{ ...d.block, x: 20, y: 20 }] } };
}

/** YAML preview for a snippet: only possible if it starts with a start block (hat). */
export function snippetYaml(d: SnippetData): string | null {
  const spec = SPEC_BY_TYPE[d.block?.type];
  if (!spec || spec.shape !== 'hat') return null;
  const kind = spec.cat === 'compose' ? 'compose' : 'k8s';
  return yamlOf(snippetState(d), kind).yaml;
}

/** Where a snippet's first block belongs, in words. */
export function snippetWhere(d: SnippetData): string {
  const spec = SPEC_BY_TYPE[d.block?.type];
  if (!spec) return '';
  if (spec.shape === 'hat') return 'Startblock – liegt frei auf der Arbeitsfläche';
  return spec.where ? `gehört ${spec.where}` : '';
}

/** Project variables for preview: values of the first environment. */
export function projectVars(p: ProjectData): Record<string, string> {
  const env = p.envs[0];
  return Object.fromEntries(p.variables.filter((v) => v.name).map((v) => [v.name, v.values[env] ?? '']));
}
