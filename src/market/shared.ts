// Marketplace data model + validation, shared by the app (before upload) and the server (on upload).
// No Blockly / DOM imports here: the server bundles this file.
import { ALL_BLOCKS, SPEC_BY_TYPE } from '../blocks/defs';

/** what is shared */
export type ItemKind = 'snippet' | 'file' | 'project';
/** which editor it belongs to */
export type ItemTarget = 'compose' | 'k8s' | 'mixed' | 'any';
export type SortKey = 'new' | 'popular' | 'stars' | 'updated';

export const KIND_LABEL: Record<ItemKind, string> = { snippet: 'Block-Kombination', file: 'Datei', project: 'Projekt' };
export const KIND_PLURAL: Record<ItemKind, string> = { snippet: 'Block-Kombinationen', file: 'Dateien', project: 'Projekte' };
export const TARGET_LABEL: Record<ItemTarget, string> = { compose: 'Docker Compose', k8s: 'Kubernetes / OpenShift', mixed: 'Compose + Kubernetes', any: 'überall' };

export const LIMITS = {
  title: [3, 80] as const,
  description: 3000,
  tags: 6,
  tagLen: 24,
  bytes: 1_500_000,
  blocks: 4000,
  files: 60,
  pageSize: 24,
};

/** item payloads (what gets downloaded) */
export interface SnippetData {
  /** Blockly block serialization of the first block, incl. its "next" chain */
  block: any;
}
export interface FileData {
  name: string;
  kind: 'compose' | 'k8s';
  state: any;
}
export interface ProjectData {
  title: string;
  files: FileData[];
  variables: { name: string; values: Record<string, string> }[];
  envs: string[];
}
export type ItemData = SnippetData | FileData | ProjectData;

/** list entry (no payload) */
export interface MarketItem {
  id: string;
  kind: ItemKind;
  target: ItemTarget;
  title: string;
  description: string;
  tags: string[];
  author: { id: number; name: string };
  blockCount: number;
  fileCount: number;
  bytes: number;
  downloads: number;
  stars: number;
  starred: boolean;
  mine: boolean;
  hidden: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface MarketItemFull extends MarketItem {
  data: ItemData;
}

export interface PublishInput {
  kind: ItemKind;
  title: string;
  description: string;
  tags: string[];
  data: ItemData;
}

// ------------------------------------------------------------------ helpers
const KNOWN = new Set(ALL_BLOCKS.map((b) => b.type));
const COMPOSE_CATS = new Set(['compose', 'service']);
const K8S_CATS = new Set(['resources', 'metadata', 'pod', 'container', 'network', 'data', 'build', 'scaling']);

/** every block "type" inside a serialization (workspace state, block state, …) */
export function blockTypes(j: any, out: string[] = []): string[] {
  if (!j || typeof j !== 'object') return out;
  if (Array.isArray(j)) {
    for (const x of j) blockTypes(x, out);
    return out;
  }
  // Blockly block state: {type, id?, x?, y?, fields?, inputs?: {NAME: {block}}, next?: {block}}
  if (typeof j.type === 'string') out.push(j.type);
  for (const [k, v] of Object.entries(j)) if (k !== 'fields' && v && typeof v === 'object') blockTypes(v, out);
  return out;
}

export function targetOf(types: string[]): ItemTarget {
  let compose = false;
  let k8s = false;
  for (const t of types) {
    const cat = SPEC_BY_TYPE[t]?.cat;
    if (cat && COMPOSE_CATS.has(cat)) compose = true;
    if (cat && K8S_CATS.has(cat)) k8s = true;
  }
  return compose && k8s ? 'mixed' : compose ? 'compose' : k8s ? 'k8s' : 'any';
}

export function normTag(t: string): string {
  return String(t)
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/[^a-z0-9äöüß+.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.tagLen);
}

/** split "nginx, postgres #db" into tags */
export function parseTags(s: string | string[]): string[] {
  const raw = Array.isArray(s) ? s : String(s).split(/[,\s]+/);
  return [...new Set(raw.map(normTag).filter(Boolean))].slice(0, LIMITS.tags);
}

function workspaceBlocks(state: any): any[] {
  return state?.blocks?.blocks ?? [];
}

export interface Checked {
  target: ItemTarget;
  blockCount: number;
  fileCount: number;
  bytes: number;
  data: ItemData;
}

/** Validates a publish request. Throws Error with a German message for the user. */
export function checkPublish(input: any): Checked & { title: string; description: string; tags: string[]; kind: ItemKind } {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Anfrage.');
  const kind = input.kind as ItemKind;
  if (!['snippet', 'file', 'project'].includes(kind)) throw new Error('Unbekannte Art.');
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  if (title.length < LIMITS.title[0]) throw new Error(`Der Titel braucht mindestens ${LIMITS.title[0]} Zeichen.`);
  if (title.length > LIMITS.title[1]) throw new Error(`Der Titel darf höchstens ${LIMITS.title[1]} Zeichen haben.`);
  const description = String(input.description ?? '').trim();
  if (description.length > LIMITS.description) throw new Error(`Die Beschreibung darf höchstens ${LIMITS.description} Zeichen haben.`);
  const tags = parseTags(Array.isArray(input.tags) ? input.tags : []);
  const c = checkData(kind, input.data);
  return { ...c, kind, title, description, tags };
}

export function checkData(kind: ItemKind, data: any): Checked {
  if (!data || typeof data !== 'object') throw new Error('Inhalt fehlt.');
  let clean: ItemData;
  let types: string[];
  let fileCount = 0;
  const fileOf = (f: any, i = 0): FileData => {
    if (!f || typeof f !== 'object') throw new Error(`Datei ${i + 1} ist ungültig.`);
    const name = String(f.name ?? '').trim().slice(0, 120) || `datei-${i + 1}.yaml`;
    if (f.kind !== 'compose' && f.kind !== 'k8s') throw new Error(`Datei "${name}": unbekannter Typ.`);
    if (!f.state || typeof f.state !== 'object' || !Array.isArray(workspaceBlocks(f.state))) throw new Error(`Datei "${name}" enthält keine Blöcke.`);
    return { name, kind: f.kind, state: { blocks: { languageVersion: 0, blocks: workspaceBlocks(f.state) } } };
  };
  if (kind === 'snippet') {
    if (!data.block || typeof data.block !== 'object' || typeof data.block.type !== 'string') throw new Error('Die Block-Kombination ist leer.');
    clean = { block: data.block };
    types = blockTypes(data.block);
  } else if (kind === 'file') {
    const f = fileOf(data);
    clean = f;
    types = blockTypes(f.state);
    fileCount = 1;
  } else {
    if (!Array.isArray(data.files) || !data.files.length) throw new Error('Das Projekt hat keine Dateien.');
    if (data.files.length > LIMITS.files) throw new Error(`Höchstens ${LIMITS.files} Dateien pro Projekt.`);
    const files = data.files.map(fileOf);
    const envs = (Array.isArray(data.envs) ? data.envs : ['dev']).map((e: any) => String(e).slice(0, 40)).filter(Boolean).slice(0, 20);
    const variables = (Array.isArray(data.variables) ? data.variables : []).slice(0, 300).map((v: any) => ({
      name: String(v?.name ?? '').slice(0, 100),
      values: Object.fromEntries(Object.entries(v?.values ?? {}).slice(0, 20).map(([k, x]) => [String(k).slice(0, 40), String(x ?? '').slice(0, 4000)])),
    }));
    clean = { title: String(data.title ?? '').slice(0, 120), files, variables, envs: envs.length ? envs : ['dev'] };
    types = files.flatMap((f: FileData) => blockTypes(f.state));
    fileCount = files.length;
  }
  if (!types.length) throw new Error('Es sind keine Blöcke enthalten.');
  const unknown = [...new Set(types.filter((t) => !KNOWN.has(t)))];
  if (unknown.length) throw new Error(`Unbekannte Blöcke: ${unknown.slice(0, 5).join(', ')}. Bitte BYOBYaml aktualisieren.`);
  if (types.length > LIMITS.blocks) throw new Error(`Zu groß: höchstens ${LIMITS.blocks} Blöcke.`);
  const bytes = JSON.stringify(clean).length;
  if (bytes > LIMITS.bytes) throw new Error(`Zu groß: höchstens ${Math.round(LIMITS.bytes / 1000)} KB.`);
  return { target: targetOf(types), blockCount: types.length, fileCount, bytes, data: clean };
}

// ------------------------------------------------------------------ secret scan (client side warning)
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|auth|dsn|connection[_-]?string)/i;
const SECRET_VAL = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/;
const PLACEHOLDER = /^(\$\{[^}]+\}|\$\{\{[^}]+\}\}|change-?me|changeme|example|xxx+|\*+|<[^>]+>|)$/i;
const SECRET_BLOCKS = new Set(['k8s_secret']);

export interface SecretHint {
  where: string;
  key: string;
}

/** Finds values that look like passwords/keys. Used to warn before publishing. */
export function findSecrets(data: ItemData): SecretHint[] {
  const out: SecretHint[] = [];
  const walk = (j: any, where: string, inSecret: boolean) => {
    if (!j || typeof j !== 'object') return;
    if (Array.isArray(j)) return j.forEach((x) => walk(x, where, inSecret));
    const isSecretDoc = inSecret || SECRET_BLOCKS.has(j.type);
    if (j.fields && typeof j.fields === 'object') {
      const f = j.fields;
      const keyName = String(f.K ?? f.NAME ?? f.KEY ?? '');
      for (const [fk, fv] of Object.entries(f)) {
        const val = String(fv ?? '');
        if (PLACEHOLDER.test(val.trim()) || /^(TRUE|FALSE)$/.test(val)) continue;
        if (SECRET_VAL.test(val)) out.push({ where, key: keyName || fk });
        else if ((fk === 'V' || fk === 'VAL' || fk === 'VALUE') && (SECRET_KEY.test(keyName) || (isSecretDoc && j.type === 'data_entry'))) out.push({ where, key: keyName || fk });
      }
    }
    for (const [k, v] of Object.entries(j)) if (k !== 'fields' && v && typeof v === 'object') walk(v, where, isSecretDoc);
  };
  if ('block' in data) walk(data.block, 'Blöcke', false);
  else if ('files' in data) {
    for (const f of data.files) walk(f.state, f.name, false);
    for (const v of data.variables) {
      if (!SECRET_KEY.test(v.name)) continue;
      if (Object.values(v.values).some((x) => !PLACEHOLDER.test(String(x).trim()))) out.push({ where: 'Variablen', key: v.name });
    }
  } else walk((data as FileData).state, (data as FileData).name, false);
  // unique
  const seen = new Set<string>();
  return out.filter((h) => {
    const k = `${h.where}|${h.key}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
