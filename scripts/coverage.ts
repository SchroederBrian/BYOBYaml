// How much of a YAML file can BYOBYaml express with real blocks?
// Imports each file, counts scalar leaves of the source vs. leaves that had to go into Extras blocks,
// and runs the round-trip comparison. Usage: bun scripts/coverage.ts [dir]   (default scripts/samples)
import * as Blockly from 'blockly/core';
import YAML from 'yaml';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerBlocks } from '../src/blocks/register';
import { loadState } from '../src/blocks/value';
import { generate } from '../src/blocks/generator';
import { importYaml, parseYamlDocs } from '../src/importer';

registerBlocks();
const dir = process.argv[2] ?? join(import.meta.dir, 'samples');

const leaves = (v: any): number => (v && typeof v === 'object' ? Object.values(v).reduce((n: number, x) => n + leaves(x), 0) : 1);

function extras(state: any): { type: string; text: string }[] {
  const out: { type: string; text: string }[] = [];
  const walk = (j: any) => {
    if (!j || typeof j !== 'object') return;
    if (typeof j.type === 'string' && j.type.startsWith('x_') && j.fields) {
      const f = j.fields;
      out.push({ type: j.type, text: j.type === 'x_yaml' ? f.Y : `${f.PATH} = ${f.VAL}` });
    }
    for (const v of Object.values(j)) walk(v);
  };
  walk(state);
  return out;
}
const extraLeaves = (e: { type: string; text: string }) => {
  try {
    const val = e.type === 'x_yaml' ? YAML.parse(e.text) : YAML.parse(e.text.slice(e.text.indexOf(' = ') + 3));
    return leaves(val);
  } catch {
    return 1;
  }
};

function diff(a: any, b: any, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}

let sumAll = 0;
let sumExtra = 0;
for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), 'utf8');
  const { file } = importYaml(text, name);
  const ws = new Blockly.Workspace();
  loadState(file.state, ws);
  const res = generate(ws, {}, { passThroughUnknownVars: file.kind === 'compose' });
  ws.dispose();
  const src = parseYamlDocs(text);
  const out = parseYamlDocs(res.yaml);
  const all = src.reduce((n: number, d: any) => n + leaves(d), 0);
  const ex = extras(file.state);
  const exLeaves = ex.reduce((n, e) => n + extraLeaves(e), 0);
  sumAll += all;
  sumExtra += exLeaves;
  const blocks = JSON.stringify(file.state).match(/"type":"/g)?.length ?? 0;
  console.log(`\n=== ${name}: ${blocks} Blöcke, ${all} Werte, davon ${exLeaves} über Extras → ${(100 * (1 - exLeaves / all)).toFixed(1)} % mit eigenen Blöcken`);
  for (const e of ex) console.log(`   extra ${e.type}: ${e.text.length > 110 ? e.text.slice(0, 110) + '…' : e.text}`);
  if (res.warnings.length) console.log('   warnings:', res.warnings.map((w) => w.msg).join(' | '));
  src.forEach((s: any, i: number) => diff(s, out[i]).forEach((l) => console.log(`   diff [${s?.kind ?? 'compose'}] ${l}`)));
}
console.log(`\nGESAMT: ${(100 * (1 - sumExtra / sumAll)).toFixed(1)} % der Werte mit eigenen Blöcken (${sumExtra}/${sumAll} über Extras)`);
