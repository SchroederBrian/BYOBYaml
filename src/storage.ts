// Storage facade. Electron: SQLite in %APPDATA%\BYOBYaml\byobyaml.db. Browser (dev): localStorage.
import { Project, ProjectMeta, Snippet } from './project';

type Filter = { name: string; extensions: string[] };

interface DbApi {
  listProjects(): Promise<ProjectMeta[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(p: Project): Promise<number>;
  deleteProject(id: string): Promise<boolean>;
  listSnippets(): Promise<Snippet[]>;
  saveSnippet(s: Snippet): Promise<boolean>;
  deleteSnippet(id: string): Promise<boolean>;
  getSetting(key: string): Promise<any>;
  setSetting(key: string, value: any): Promise<boolean>;
  info(): Promise<{ file: string }>;
}

declare global {
  interface Window {
    byob?: {
      isElectron: boolean;
      saveFile(o: { defaultName: string; content: string; filters: Filter[] }): Promise<string | null>;
      openFiles(o: { filters: Filter[]; multi: boolean }): Promise<{ name: string; content: string }[]>;
      exportFolder(o: { files: { name: string; content: string }[] }): Promise<string | null>;
      revealData(): Promise<void>;
      db: DbApi;
    };
  }
}

// ---------- localStorage fallback ----------
const LS = 'byobyaml.v2.';
const lsGet = (k: string) => {
  try {
    const r = localStorage.getItem(LS + k);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: any) => localStorage.setItem(LS + k, JSON.stringify(v));

const localDb: DbApi = {
  async listProjects() {
    const all: Record<string, { p: Project; updatedAt: number }> = lsGet('projects') ?? {};
    return Object.values(all)
      .map(({ p, updatedAt }) => ({ id: p.id, title: p.title, fileCount: p.files.length, createdAt: p.createdAt ?? updatedAt, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getProject(id) {
    return (lsGet('projects') ?? {})[id]?.p ?? null;
  },
  async saveProject(p) {
    const all = lsGet('projects') ?? {};
    const now = Date.now();
    all[p.id] = { p, updatedAt: now };
    lsSet('projects', all);
    return now;
  },
  async deleteProject(id) {
    const all = lsGet('projects') ?? {};
    const had = id in all;
    delete all[id];
    lsSet('projects', all);
    return had;
  },
  async listSnippets() {
    return ((lsGet('snippets') ?? []) as Snippet[]).sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveSnippet(s) {
    const all: Snippet[] = (lsGet('snippets') ?? []).filter((x: Snippet) => x.id !== s.id);
    all.push({ ...s, createdAt: s.createdAt ?? Date.now() });
    lsSet('snippets', all);
    return true;
  },
  async deleteSnippet(id) {
    lsSet('snippets', (lsGet('snippets') ?? []).filter((x: Snippet) => x.id !== id));
    return true;
  },
  async getSetting(key) {
    return (lsGet('settings') ?? {})[key] ?? null;
  },
  async setSetting(key, value) {
    const all = lsGet('settings') ?? {};
    all[key] = value;
    lsSet('settings', all);
    return true;
  },
  async info() {
    return { file: 'Browser localStorage' };
  },
};

export const db: DbApi = window.byob?.db ?? localDb;
export const isDesktop = !!window.byob?.isElectron;

// ---------- file IO ----------
export async function saveText(defaultName: string, content: string, ext: string[]): Promise<string | null> {
  if (window.byob) return window.byob.saveFile({ defaultName, content, filters: [{ name: ext.join(', '), extensions: ext }] });
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return defaultName;
}

export async function openTexts(ext: string[], multi = true): Promise<{ name: string; content: string }[]> {
  if (window.byob) return window.byob.openFiles({ filters: [{ name: ext.join(', '), extensions: ext }], multi });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multi;
    input.accept = ext.map((e) => '.' + e).join(',');
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, content: await f.text() }))));
    input.click();
  });
}

export async function exportAll(files: { name: string; content: string }[]): Promise<string | null> {
  if (window.byob) return window.byob.exportFolder({ files });
  for (const f of files) await saveText(f.name, f.content, ['yaml']);
  return 'Downloads';
}
