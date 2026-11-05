// Project model: a project holds YAML files (each with a block workspace), variables and environments.
import { cleanFolder, normalizeFolders } from './folders';
import { normalizeVault, type SecretVaultEnvelope } from './secrets';
import { normalizeCustomSnapshots } from './custom-blocks/model';
import { dockerfileState } from './dockerfile';

export type FileKind = 'compose' | 'k8s' | 'dockerfile';
export const fileKindLabel = (kind?: FileKind) => kind === 'dockerfile' ? 'Dockerfile' : kind === 'compose' ? 'Docker Compose' : 'Kubernetes / OpenShift';
export const outputExtensions = (kind?: FileKind) => kind === 'dockerfile' ? ['*'] : ['yaml','yml'];

export interface ProjectFile {
  id: string;
  name: string;
  kind: FileKind;
  /** Blockly workspace serialization */
  state: any;
  /** Variables visible only to this file; same names override project variables. */
  variables?: Variable[];
  /** Run Blockly "clean up" once after loading (imports). */
  needsLayout?: boolean;
  /** folder in the file explorer, e.g. "base/apps" ('' / missing = top level) */
  folder?: string;
}

export interface Variable {
  name: string;
  /** value per environment name */
  values: Record<string, string>;
}

export interface Project {
  format: 'byobyaml';
  version: 2;
  id: string;
  title: string;
  createdAt?: number;
  files: ProjectFile[];
  variables: Variable[];
  envs: string[];
  activeEnv: string;
  /** folders of the file explorer (also empty ones) */
  folders?: string[];
  /** Authenticated ciphertext only. Master password and unlocked secrets are never serialized. */
  secretVault?: SecretVaultEnvelope;
}

export interface ProjectMeta {
  id: string;
  title: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface Snippet {
  id: string;
  name: string;
  category: string;
  createdAt?: number;
  /** Blockly block serialization (top block incl. next chain) */
  block: any;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Accepts v1 or v2 project objects and returns a valid v2 project. */
export function normalizeProject(p: any): Project {
  if (!p || p.format !== 'byobyaml' || !Array.isArray(p.files)) throw new Error('Keine gültige BYOBYaml-Projektdatei');
  const envs: string[] = Array.isArray(p.envs) && p.envs.length ? p.envs : ['dev'];
  const files: ProjectFile[] = p.files.map((f: any) => {
    normalizeCustomSnapshots(f.state);
    const folder = cleanFolder(f.folder);
    return { ...(Array.isArray(f.variables) ? { variables: normalizeVariables(f.variables) } : {}), id: f.id || uid(), name: f.name || (f.kind === 'dockerfile' ? 'Dockerfile' : 'datei.yaml'), kind: f.kind === 'dockerfile' ? 'dockerfile' : f.kind === 'compose' ? 'compose' : 'k8s', state: f.state, needsLayout: f.needsLayout, ...(folder ? { folder } : {}) };
  });
  return {
    format: 'byobyaml',
    version: 2,
    id: typeof p.id === 'string' ? p.id : uid(),
    title: p.title || 'Unbenannt',
    createdAt: p.createdAt,
    files,
    variables: normalizeVariables(p.variables),
    envs,
    activeEnv: envs.includes(p.activeEnv) ? p.activeEnv : envs[0],
    folders: normalizeFolders(Array.isArray(p.folders) ? p.folders : [], files.map((f) => f.folder ?? '')),
    ...(p.secretVault != null ? { secretVault: normalizeVault(p.secretVault) } : {}),
  };
}

function normalizeVariables(variables: any): Variable[] {
  return Array.isArray(variables) ? variables.filter((v: any) => v && v.name).map((v: any) => ({ name: String(v.name), values: { ...(v.values || {}) } })) : [];
}

/** Resolve globals first, then this file's overrides, for the active environment. */
export function resolveVariables(project: Pick<Project, 'variables' | 'activeEnv'> | null, file?: Pick<ProjectFile, 'variables'>): Record<string, string> {
  if (!project) return {};
  return Object.fromEntries([...project.variables, ...(file?.variables ?? [])].filter((v) => v.name).map((v) => [v.name, v.values[project.activeEnv] ?? '']));
}

// ---------- tiny builders for block serialization ----------
export interface B {
  type: string;
  fields?: Record<string, any>;
  body?: B[];
}

export const b = (type: string, fields: Record<string, any> = {}, body?: B[]): B => ({ type, fields, body });

export function chainJson(blocks: B[]): any {
  if (!blocks.length) return undefined;
  const [first, ...rest] = blocks;
  const j: any = { type: first.type, fields: normalizeFields(first.fields ?? {}) };
  if (first.body?.length) j.inputs = { BODY: { block: chainJson(first.body) } };
  const next = chainJson(rest);
  if (next) j.next = { block: next };
  return j;
}

function normalizeFields(f: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
  return out;
}

/** A hat + blocks stacked under it, placed at x/y. */
export function stack(hat: B, children: B[], x = 40, y = 40): any {
  return { ...chainJson([hat, ...children]), x, y };
}

export function wsState(...stacks: any[]) {
  return { blocks: { languageVersion: 0, blocks: stacks } };
}

export function file(name: string, kind: FileKind, ...stacks: any[]): ProjectFile {
  return { id: uid(), name, kind, state: wsState(...stacks) };
}

export function emptyFile(kind: FileKind, existing: string[]): ProjectFile {
  if (kind === 'dockerfile') return { id:uid(),name:uniqueName('Dockerfile',existing),kind,state:dockerfileState([{type:'df_from',fields:{IMAGE:'alpine:3'}},{type:'df_workdir',fields:{PATH:'/app'}},{type:'df_cmd',fields:{ARGS:'sh'}}]) };
  const base = kind === 'compose' ? 'docker-compose' : 'resource';
  const name = uniqueName(`${base}.yaml`, existing);
  const starter = kind === 'compose' ? stack(b('compose_file', { NAME: '' }), []) : stack(b('k8s_deployment', { NAME: 'my-app', REPLICAS: 1 }), []);
  return { id: uid(), name, kind, state: wsState(starter) };
}

export function uniqueName(name: string, existing: string[]) {
  if (!existing.includes(name)) return name;
  const m = name.match(/^(.*?)(\.[^.]+)?$/)!;
  let i = 2;
  while (existing.includes(`${m[1]}-${i}${m[2] ?? ''}`)) i++;
  return `${m[1]}-${i}${m[2] ?? ''}`;
}

export function newProject(title = 'Neues Projekt'): Project {
  return {
    format: 'byobyaml',
    version: 2,
    id: uid(),
    title,
    createdAt: Date.now(),
    files: [emptyFile('compose', [])],
    variables: [],
    envs: ['dev', 'prod'],
    activeEnv: 'dev',
  };
}

// ---------- .byob container format ----------
export interface ByobFile {
  format: 'byobyaml';
  kind: 'project' | 'bundle';
  version: 2;
  exportedAt: string;
  projects: Project[];
  snippets?: Snippet[];
}

export function toByob(projects: Project[], snippets?: Snippet[]): string {
  const f: ByobFile = {
    format: 'byobyaml',
    kind: snippets ? 'bundle' : 'project',
    version: 2,
    exportedAt: new Date().toISOString(),
    projects,
    snippets,
  };
  return JSON.stringify(f, null, 2);
}

export function parseByob(text: string): { projects: Project[]; snippets: Snippet[] } {
  const j = JSON.parse(text);
  if (j?.format !== 'byobyaml') throw new Error('Keine BYOBYaml-Datei');
  // legacy: a bare v1 project
  if (Array.isArray(j.files)) return { projects: [normalizeProject(j)], snippets: [] };
  return {
    projects: (j.projects ?? []).map(normalizeProject),
    snippets: (j.snippets ?? []).filter((s: any) => s?.block && s?.name).map((snippet: Snippet) => ({ ...snippet, block: normalizeCustomSnapshots(snippet.block) })),
  };
}
