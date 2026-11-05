// Folder paths for the file explorer: "base/apps" style, no leading/trailing slash. '' = top level.
// Pure helpers (also used by the server for marketplace validation).

export const MAX_DEPTH = 6;

/** "/a\\ b/../c/" → "a/b/c" (no empty, ".", ".." segments; max 60 chars each) */
export function cleanFolder(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .split(/[\\/]+/)
    .map((x) => x.trim().replace(/[\u0000-\u001f<>:"|?*]/g, '').slice(0, 60))
    .filter((x) => x && x !== '.' && x !== '..')
    .slice(0, MAX_DEPTH)
    .join('/');
}

/** "a/b/c" → ["a", "a/b", "a/b/c"] */
export function withParents(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
export const baseName = (path: string) => path.split('/').pop() ?? path;
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
/** is `path` the folder `root` or inside it */
export const isInside = (path: string, root: string) => !!root && (path === root || path.startsWith(root + '/'));

/** all folders (incl. parents) as a sorted unique list */
export function normalizeFolders(folders: string[], fileFolders: string[]): string[] {
  const all = new Set<string>();
  for (const f of [...folders, ...fileFolders]) for (const p of withParents(cleanFolder(f))) all.add(p);
  return [...all].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}
