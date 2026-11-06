// Value blocks: round "reporter" blocks that plug into text/number slots and compute a value at export.
// Adding one = adding one entry to VALUE_SPECS (labels German, one eval function).
import type * as Blockly from 'blockly/core';
import type { ArgDef } from './types';
import { C, D, N, T } from './types';
import { sha256Hex } from './sha256';
import type { EvalEnv } from './value';

export interface ValueSpec {
  type: string;
  msg: string;
  args?: ArgDef[];
  tip: string;
  /** Receives resolved arguments (numbers for num args, text otherwise). Throw Error(message) to flag a problem. */
  eval: (v: Record<string, any>, env: EvalEnv, block: Blockly.Block) => string | number;
  /** Search keywords beyond the label. */
  keywords?: string;
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz', UPPER = LOWER.toUpperCase(), DIGITS = '0123456789';
const CHARSETS: Record<string, string> = { lowerdigits: LOWER + DIGITS, lower: LOWER, upper: UPPER, digits: DIGITS, mixed: LOWER + UPPER + DIGITS };
const pad = (n: number, size = 2) => String(n).padStart(size, '0');
const pick = (rng: () => number, chars: string) => chars[Math.floor(rng() * chars.length)];
const isTrue = (value: unknown) => /^(true|1|yes|ja|on|an|wahr)$/i.test(String(value).trim());
const asNumber = (value: unknown): number | null => (String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const length = (n: number, max = 4096) => {
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Die Länge muss eine ganze Zahl von 1 bis ${max} sein.`);
  return n;
};

const base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const VALUE_SPECS: ValueSpec[] = [
  {
    type: 'val_random_int', msg: 'Zufallszahl von %1 bis %2', args: [N('MIN', 1), N('MAX', 100)], keywords: 'random zufall nummer',
    tip: 'Eine neue ganze Zufallszahl bei jedem Export (beide Grenzen eingeschlossen).',
    eval: (v, { rng }) => {
      const low = Math.ceil(v.MIN), high = Math.floor(v.MAX);
      if (high < low) throw new Error('Das Minimum ist größer als das Maximum.');
      return Math.floor(rng() * (high - low + 1)) + low;
    },
  },
  {
    type: 'val_random_text', msg: 'Zufallstext Länge %1 aus %2', args: [N('LEN', 8), D('SET', [['Kleinbuchstaben + Ziffern', 'lowerdigits'], ['Kleinbuchstaben', 'lower'], ['Großbuchstaben', 'upper'], ['Ziffern', 'digits'], ['Buchstaben + Ziffern', 'mixed']])], keywords: 'random zufall string zeichen',
    tip: 'Ein neuer Zufallstext bei jedem Export.',
    eval: (v, { rng }) => Array.from({ length: length(v.LEN) }, () => pick(rng, CHARSETS[v.SET] ?? CHARSETS.lowerdigits)).join(''),
  },
  {
    type: 'val_uuid', msg: 'UUID', keywords: 'random zufall id kennung',
    tip: 'Eine neue UUID (Version 4) bei jedem Export.',
    eval: (_v, { rng }) => {
      const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  },
  {
    type: 'val_timestamp', msg: 'Zeitstempel %1', args: [D('FORMAT', [['ISO 8601', 'iso'], ['Unix (Sekunden)', 'unix'], ['Datum JJJJ-MM-TT', 'date'], ['Uhrzeit HH:MM:SS', 'time'], ['Kompakt JJJJMMTThhmmss', 'compact']])], keywords: 'zeit datum uhrzeit time date now jetzt',
    tip: 'Zeitpunkt des Exports (UTC). Alle Dateien eines Exports teilen sich denselben Zeitpunkt.',
    eval: (v, { session }) => {
      const d = session.now, date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      switch (v.FORMAT) {
        case 'unix': return Math.floor(d.getTime() / 1000);
        case 'date': return date;
        case 'time': return time;
        case 'compact': return (date + time).replace(/[-:]/g, '');
        default: return d.toISOString();
      }
    },
  },
  {
    type: 'val_join', msg: 'Verbinde %1 und %2 mit Trenner %3', args: [T('A', ''), T('B', ''), T('SEP', '')], keywords: 'text zusammen concat join',
    tip: 'Fügt zwei Werte mit einem Trenner dazwischen zusammen. Ineinander stecken für mehr Teile.',
    eval: (v) => `${v.A}${v.SEP}${v.B}`,
  },
  {
    type: 'val_variable', msg: 'Variable %1', args: [T('NAME', 'APP')], keywords: 'variable umgebungsvariable',
    tip: 'Wert einer Projekt- oder Datei-Variable in der aktiven Umgebung.',
    eval: (v, env) => {
      const name = String(v.NAME).trim();
      if (name in env.vars) return env.vars[name];
      if (env.passThrough) return '${' + name + '}';
      throw new Error('Variable ${' + name + '} ist nicht definiert.');
    },
  },
  {
    type: 'val_env', msg: 'Umgebung', keywords: 'dev prod stage environment',
    tip: 'Name der aktiven Umgebung, z. B. dev oder prod.',
    eval: (_v, { session }) => session.envName,
  },
  {
    type: 'val_compare', msg: 'Ist %1 %2 %3', args: [T('A', ''), D('OP', [['gleich', 'eq'], ['ungleich', 'ne'], ['kleiner als', 'lt'], ['größer als', 'gt'], ['höchstens', 'le'], ['mindestens', 'ge']]), T('B', '')], keywords: 'vergleich bedingung gleich',
    tip: 'Ergibt true oder false. Zahlen werden als Zahlen verglichen, sonst als Text.',
    eval: (v) => {
      const a = asNumber(v.A), b = asNumber(v.B), numeric = a !== null && b !== null;
      const cmp = numeric ? Math.sign(a! - b!) : String(v.A).localeCompare(String(v.B), 'de');
      return String({ eq: cmp === 0, ne: cmp !== 0, lt: cmp < 0, gt: cmp > 0, le: cmp <= 0, ge: cmp >= 0 }[v.OP as string] ?? false);
    },
  },
  {
    type: 'val_if', msg: 'Wenn %1 dann %2 sonst %3', args: [T('COND', 'true'), T('THEN', ''), T('ELSE', '')], keywords: 'bedingung if wenn dann sonst',
    tip: 'Wählt zwischen zwei Werten. Als Bedingung gelten true, 1, yes, ja, on, an.',
    eval: (v) => (isTrue(v.COND) ? v.THEN : v.ELSE),
  },
  {
    type: 'val_counter', msg: 'Zähler %1 ab %2', args: [T('KEY', 'zaehler'), N('START', 1)], keywords: 'nummer laufende counter index port',
    tip: 'Blöcke mit demselben Zähler-Namen zählen gemeinsam hoch: ab dem Startwert 1, 2, 3 … in der Reihenfolge der Ausgabe, z. B. für fortlaufende Ports.',
    eval: (v, { counters }) => {
      const key = String(v.KEY);
      const next = counters.has(key) ? counters.get(key)! + 1 : v.START;
      counters.set(key, next);
      return next;
    },
  },
  {
    type: 'val_random_hex', msg: 'Hex-Token aus %1 Bytes', args: [N('BYTES', 16)], keywords: 'random zufall token schluessel secret',
    tip: 'Ein neuer Zufalls-Token aus Hexadezimalzeichen (2 Zeichen je Byte).',
    eval: (v, { rng }) => Array.from({ length: length(v.BYTES, 512) }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join(''),
  },
  {
    type: 'val_random_pick', msg: 'Zufällig aus Liste %1', args: [T('LIST', 'rot,gruen,blau')], keywords: 'random zufall auswahl liste',
    tip: 'Wählt bei jedem Export einen Eintrag der kommagetrennten Liste.',
    eval: (v, { rng }) => {
      const items = String(v.LIST).split(',').map((item) => item.trim()).filter(Boolean);
      if (!items.length) throw new Error('Die Liste ist leer.');
      return items[Math.floor(rng() * items.length)];
    },
  },
  {
    type: 'val_random_port', msg: 'Zufallsport von %1 bis %2', args: [N('MIN', 20000), N('MAX', 60000)], keywords: 'random zufall port netzwerk',
    tip: 'Ein neuer Zufallsport (1–65535).',
    eval: (v, { rng }) => {
      const low = Math.ceil(v.MIN), high = Math.floor(v.MAX);
      if (low < 1 || high > 65535 || high < low) throw new Error('Ports müssen zwischen 1 und 65535 liegen, das Minimum darf nicht größer sein.');
      return Math.floor(rng() * (high - low + 1)) + low;
    },
  },
  {
    type: 'val_random_password', msg: 'Passwort Länge %1 mit Sonderzeichen %2', args: [N('LEN', 20), C('SYM', false)], keywords: 'random zufall kennwort password secret',
    tip: 'Ein neues Passwort mit Klein-, Großbuchstaben und Ziffern (optional Sonderzeichen). Es wird bei jedem Export neu erzeugt und nirgends gespeichert.',
    eval: (v, { rng }) => {
      const size = length(v.LEN, 1024);
      if (size < 4) throw new Error('Ein Passwort braucht mindestens 4 Zeichen.');
      const classes = [LOWER, UPPER, DIGITS, ...(v.SYM ? ['!#%&*+-=?@^_'] : [])];
      const all = classes.join('');
      const chars = [...classes.map((set) => pick(rng, set)), ...Array.from({ length: size - classes.length }, () => pick(rng, all))];
      for (let i = chars.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [chars[i], chars[j]] = [chars[j], chars[i]]; }
      return chars.join('');
    },
  },
  {
    type: 'val_random_color', msg: 'Zufallsfarbe', keywords: 'random zufall farbe hex color',
    tip: 'Eine neue Farbe als #rrggbb.',
    eval: (_v, { rng }) => '#' + Array.from({ length: 3 }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join(''),
  },
  {
    type: 'val_date_offset', msg: 'Datum in %1 Tagen', args: [N('DAYS', 1)], keywords: 'zeit datum morgen gestern offset ablauf',
    tip: 'Das Datum (JJJJ-MM-TT, UTC) vom Export-Zeitpunkt aus gerechnet. Negative Zahlen liegen in der Vergangenheit.',
    eval: (v, { session }) => {
      const d = new Date(session.now.getTime() + Math.trunc(v.DAYS) * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    },
  },
  { type: 'val_upper', msg: 'GROSS %1', args: [T('TEXT', '')], keywords: 'text gross upper', tip: 'Wandelt in Großbuchstaben um.', eval: (v) => String(v.TEXT).toLocaleUpperCase('de') },
  { type: 'val_lower', msg: 'klein %1', args: [T('TEXT', '')], keywords: 'text klein lower', tip: 'Wandelt in Kleinbuchstaben um.', eval: (v) => String(v.TEXT).toLocaleLowerCase('de') },
  {
    type: 'val_slug', msg: 'Name-tauglich aus %1', args: [T('TEXT', '')], keywords: 'text slug dns name bezeichner',
    tip: 'Macht aus Text einen Namen aus Kleinbuchstaben, Ziffern und Bindestrichen (Umlaute werden aufgelöst).',
    eval: (v) => String(v.TEXT).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  },
  {
    type: 'val_replace', msg: 'Ersetze %1 in %2 durch %3', args: [T('FIND', '-'), T('TEXT', 'a-b'), T('WITH', '_')], keywords: 'text ersetzen replace',
    tip: 'Ersetzt jedes Vorkommen des Suchtexts (kein Muster, nur Text).',
    eval: (v) => {
      if (v.FIND === '') throw new Error('Der Suchtext darf nicht leer sein.');
      return String(v.TEXT).split(v.FIND).join(v.WITH);
    },
  },
  {
    type: 'val_substring', msg: 'Teil von %1 ab Zeichen %2 Länge %3', args: [T('TEXT', ''), N('FROM', 1), N('LEN', 5)], keywords: 'text teil substring',
    tip: 'Schneidet ein Stück aus dem Text. Das erste Zeichen ist Nr. 1.',
    eval: (v) => {
      if (v.FROM < 1 || v.LEN < 0) throw new Error('Start muss mindestens 1 und die Länge mindestens 0 sein.');
      return String(v.TEXT).slice(Math.trunc(v.FROM) - 1, Math.trunc(v.FROM) - 1 + Math.trunc(v.LEN));
    },
  },
  {
    type: 'val_repeat', msg: 'Wiederhole %1 mal %2', args: [N('COUNT', 3), T('TEXT', 'x')], keywords: 'text wiederholen repeat',
    tip: 'Wiederholt den Text (höchstens 100000 Zeichen insgesamt).',
    eval: (v) => {
      const count = Math.trunc(v.COUNT);
      if (count < 0 || count * String(v.TEXT).length > 100000) throw new Error('Zu viele Wiederholungen (höchstens 100000 Zeichen).');
      return String(v.TEXT).repeat(count);
    },
  },
  { type: 'val_length', msg: 'Länge von %1', args: [T('TEXT', '')], keywords: 'text laenge length', tip: 'Anzahl der Zeichen.', eval: (v) => Array.from(String(v.TEXT)).length },
  { type: 'val_base64', msg: 'Base64 von %1', args: [T('TEXT', '')], keywords: 'text kodieren encode secret', tip: 'Base64-Kodierung (UTF-8), z. B. für Kubernetes-Secret-Werte.', eval: (v) => base64(String(v.TEXT)) },
  { type: 'val_sha256', msg: 'SHA-256 von %1', args: [T('TEXT', '')], keywords: 'text hash pruefsumme checksum', tip: 'Prüfsumme als 64 Hexzeichen.', eval: (v) => sha256Hex(String(v.TEXT)) },
  { type: 'val_urlencode', msg: 'URL-kodiert %1', args: [T('TEXT', '')], keywords: 'text url kodieren encode', tip: 'Kodiert Sonderzeichen für die Verwendung in URLs (z. B. Passwörter in Verbindungs-URLs).', eval: (v) => encodeURIComponent(String(v.TEXT)) },
  {
    type: 'val_math', msg: 'Rechne %1 %2 %3', args: [N('A', 1), D('OP', [['+', 'add'], ['−', 'sub'], ['×', 'mul'], ['÷', 'div'], ['Rest von ÷', 'mod']]), N('B', 1)], keywords: 'mathe rechnen plus minus mal geteilt',
    tip: 'Grundrechenarten. Division durch 0 ist ein Fehler.',
    eval: (v) => {
      if ((v.OP === 'div' || v.OP === 'mod') && v.B === 0) throw new Error('Division durch 0.');
      return { add: v.A + v.B, sub: v.A - v.B, mul: v.A * v.B, div: v.A / v.B, mod: v.A % v.B }[v.OP as string] ?? 0;
    },
  },
  {
    type: 'val_round', msg: 'Runde %1 auf %2 Stellen', args: [N('X', 0), N('DIGITS', 0)], keywords: 'mathe runden round',
    tip: 'Rundet auf die angegebene Zahl von Nachkommastellen (0–10).',
    eval: (v) => {
      const digits = Math.trunc(v.DIGITS);
      if (digits < 0 || digits > 10) throw new Error('Nachkommastellen: 0 bis 10.');
      return Number(Math.round(Number(v.X + 'e' + digits)) + 'e-' + digits);
    },
  },
  {
    type: 'val_minmax', msg: 'Von %1 und %2 der %3 Wert', args: [N('A', 1), N('B', 2), D('WHICH', [['kleinere', 'min'], ['größere', 'max']])], keywords: 'mathe minimum maximum',
    tip: 'Der kleinere oder größere von zwei Werten.',
    eval: (v) => (v.WHICH === 'max' ? Math.max(v.A, v.B) : Math.min(v.A, v.B)),
  },
  { type: 'val_project_name', msg: 'Projektname', keywords: 'projekt name', tip: 'Titel des Projekts.', eval: (_v, { session }) => session.projectName },
  { type: 'val_file_name', msg: 'Dateiname', keywords: 'datei name', tip: 'Name der Datei, in der dieser Block steht (mit Endung).', eval: (_v, { session }) => session.fileName },
  {
    type: 'val_remember', msg: 'Merke %1 als %2', args: [T('KEY', 'passwort'), T('VALUE', '')], keywords: 'merken speichern gleich wiederverwenden secret passwort datei',
    tip: 'Der erste Wert unter diesem Namen gilt im ganzen Export, auch in anderen Dateien. So steht dasselbe Zufallspasswort in Secret und Anwendung.',
    eval: (v, { memo }) => {
      const key = String(v.KEY);
      if (!memo.has(key)) memo.set(key, v.VALUE);
      return memo.get(key)!;
    },
  },
];

export const VALUE_BY_TYPE: Record<string, ValueSpec> = Object.fromEntries(VALUE_SPECS.map((spec) => [spec.type, spec]));

/** Toolbox sections, in order. */
export const VALUE_GROUPS: { title: string; types: string[] }[] = [
  { title: 'Zufall', types: ['val_random_int', 'val_random_text', 'val_random_hex', 'val_random_password', 'val_uuid', 'val_random_pick', 'val_random_port', 'val_random_color'] },
  { title: 'Zeit', types: ['val_timestamp', 'val_date_offset'] },
  { title: 'Text', types: ['val_join', 'val_upper', 'val_lower', 'val_slug', 'val_replace', 'val_substring', 'val_repeat', 'val_length', 'val_base64', 'val_sha256', 'val_urlencode'] },
  { title: 'Rechnen', types: ['val_math', 'val_round', 'val_minmax', 'val_counter'] },
  { title: 'Logik', types: ['val_compare', 'val_if'] },
  { title: 'Kontext', types: ['val_variable', 'val_env', 'val_project_name', 'val_file_name', 'val_remember'] },
];
