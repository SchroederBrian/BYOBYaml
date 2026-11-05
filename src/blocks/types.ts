// Shared types + tiny DSL helpers for defining BYOBYaml blocks.

export type CatId =
  | 'compose'
  | 'service'
  | 'resources'
  | 'metadata'
  | 'pod'
  | 'container'
  | 'network'
  | 'data'
  | 'build'
  | 'scaling'
  | 'extras';

export interface Category {
  id: CatId;
  name: string;
  colour: string; // primary
  secondary: string;
  tertiary: string;
}

// Muted, professional palette: one hue per category, readable on a dark canvas.
const cat = (id: CatId, name: string, colour: string): Category => ({ id, name, colour, secondary: shade(colour, 0.18), tertiary: shade(colour, -0.22) });

export const CATEGORIES: Category[] = [
  cat('compose', 'Compose', '#3f7fd8'),
  cat('service', 'Service', '#7a68d4'),
  cat('resources', 'Ressourcen', '#c08a1e'),
  cat('metadata', 'Metadaten', '#ad5aa1'),
  cat('pod', 'Pod', '#c9702a'),
  cat('container', 'Container', '#2b8fa8'),
  cat('network', 'Netzwerk', '#3a9558'),
  cat('data', 'Config & Daten', '#b9613a'),
  cat('build', 'Build', '#bf4c66'),
  cat('scaling', 'Skalierung', '#24927a'),
  cat('extras', 'Extras', '#5f6b82'),
];

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export type ArgDef =
  | { kind: 'text'; name: string; value: string }
  | { kind: 'multi'; name: string; value: string }
  | { kind: 'num'; name: string; value: number; min?: number; precision?: number }
  | { kind: 'dd'; name: string; options: [string, string][] }
  | { kind: 'chk'; name: string; value: boolean };

export interface Ctx {
  scopes: Set<string>;
  out: any[];
  doc: any;
  target: any;
  pod?: any;
  podMeta?: any;
  container?: any;
  warn: (msg: string) => void;
}

export type RunBody = (scopes: string[], patch?: Partial<Ctx>) => void;

export interface BlockSpec {
  type: string;
  cat: CatId;
  shape: 'hat' | 'stmt' | 'c';
  msg: string;
  args?: ArgDef[];
  /** Block only works when one of these scopes is active. */
  scope?: string[];
  /** Human readable hint shown when placed in the wrong spot. */
  where?: string;
  tip?: string;
  gen: (v: Record<string, any>, ctx: Ctx, run: RunBody) => void;
}

export const T = (name: string, value = ''): ArgDef => ({ kind: 'text', name, value });
/** multi-line text (config files, scripts, certificates) */
export const M = (name: string, value = ''): ArgDef => ({ kind: 'multi', name, value });
export const N = (name: string, value = 0, min?: number, precision?: number): ArgDef => ({
  kind: 'num',
  name,
  value,
  min,
  precision,
});
export const D = (name: string, options: (string | [string, string])[]): ArgDef => ({
  kind: 'dd',
  name,
  options: options.map((o) => (Array.isArray(o) ? o : [o, o])),
});
export const C = (name: string, value = false): ArgDef => ({ kind: 'chk', name, value });

// ---------- generator helpers ----------

/** Get (and create) nested object path on obj. */
export function at(obj: any, ...path: string[]): any {
  let cur = obj;
  for (const p of path) {
    if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  return cur;
}

export function list(obj: any, key: string): any[] {
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

/** "8080" -> 8080, "http" -> "http" */
export function portVal(v: string): string | number {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** Shell-ish split that respects quotes: echo "a b" c -> ["echo","a b","c"] */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Set a dotted path like "spec.template.spec.hostNetwork". Supports [n] indices. */
export function setPath(obj: any, path: string, value: any) {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = nextIsIndex ? [] : {};
    cur = cur[k];
  }
  if (parts.length) cur[parts[parts.length - 1]] = value;
}

export function deepMerge(target: any, src: any) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else if (Array.isArray(v) && Array.isArray(target[k])) {
      target[k].push(...v);
    } else {
      target[k] = v;
    }
  }
}
