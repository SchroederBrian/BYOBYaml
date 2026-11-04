// Import YAML samples → blocks → YAML again, then report semantic differences.
// Run: bun scripts/roundtrip.ts
import * as Blockly from 'blockly/core';
import YAML from 'yaml';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerBlocks } from '../src/blocks/register';
import { generate } from '../src/blocks/generator';
import { importYaml } from '../src/importer';

registerBlocks();
const dir = join(import.meta.dir, 'samples');
const STRIP_META = ['uid', 'resourceVersion', 'creationTimestamp', 'generation', 'managedFields', 'selfLink', 'ownerReferences'];
const STRIP_ANN = ['kubectl.kubernetes.io/last-applied-configuration', 'deployment.kubernetes.io/revision', 'openshift.io/generated-by'];

function expected(doc: any) {
  const d = structuredClone(doc);
  delete d.status;
  if (d.metadata) {
    for (const k of STRIP_META) delete d.metadata[k];
    if (d.metadata.annotations) {
      for (const k of STRIP_ANN) delete d.metadata.annotations[k];
      if (!Object.keys(d.metadata.annotations).length) delete d.metadata.annotations;
    }
  }
  return d;
}

function diff(a: any, b: any, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}

let total = 0;
for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), 'utf8');
  const { file, notes } = importYaml(text, name);
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(file.state, ws);
  const res = generate(ws);
  ws.dispose();
  const src = YAML.parseAllDocuments(text, { merge: true })
    .map((d) => d.toJS())
    .flatMap((d: any) => (d?.kind === 'List' ? d.items : [d]))
    .map(expected);
  const out = YAML.parseAllDocuments(res.yaml).map((d) => d.toJS());
  console.log(`\n=== ${name}: ${notes.join(' ')}`);
  if (res.warnings.length) console.log('  warnings:', res.warnings.map((w) => w.msg).join(' | '));
  src.forEach((s: any, i: number) => {
    const d = diff(s, out[i]);
    total += d.length;
    for (const line of d) console.log(`  [${s.kind ?? 'compose'} ${s.metadata?.name ?? ''}] ${line}`);
  });
}
console.log(`\n${total} Unterschiede insgesamt`);
