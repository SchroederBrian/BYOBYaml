import { describe, expect, test } from 'bun:test';
import * as Blockly from 'blockly/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_BY_TYPE } from '../src/blocks/defs';
import { registerBlocks } from '../src/blocks/register';
import { appendState, argValue, denormalizeState, loadState, normalizeState, ownerOfField, setArgValue } from '../src/blocks/value';
import { buildDependencyGraph } from '../src/dependencies';
import { buildHelmChart } from '../src/helm';
import { checkData, findSecrets } from '../src/market/shared';
import { b, file, resolveVariables, stack, wsState } from '../src/project';
import type { ProjectFile } from '../src/project';
import { openshiftDemo } from '../src/examples';
import { BUILTIN_SNIPPETS, snippetState } from '../src/snippets';
import { yamlForFile } from '../src/projectYaml';
import { goldenCases, runCase } from './value-fixtures';

registerBlocks();
const golden = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, 'samples-golden', name.replace(/[^\w.-]+/g, '_') + '.json'), 'utf8'));

describe('normalizeState', () => {
  const legacy = { blocks: { languageVersion: 0, blocks: [{ type: 'k8s_deployment', fields: { NAME: 'a', REPLICAS: '2' }, next: { block: { type: 'meta_label', fields: { K: 'k', V: 'v' } } } }] } };

  test('turns text and number fields into shadow literals', () => {
    const block = normalizeState(legacy).blocks.blocks[0] as any;
    expect(block.fields).toBeUndefined();
    expect(block.inputs.NAME.shadow).toEqual({ type: 'byob_text', fields: { VALUE: 'a' } });
    expect(block.inputs.REPLICAS.shadow).toEqual({ type: 'byob_num', fields: { VALUE: '2' } });
    expect(block.next.block.inputs.K.shadow.fields.VALUE).toBe('k');
  });

  test('keeps dropdown, checkbox and multi-line fields as fields', () => {
    const state = { blocks: { blocks: [{ type: 'svc_volume', fields: { SRC: 'a', DST: '/b', RO: 'TRUE' } }] } };
    const block = normalizeState(state).blocks.blocks[0] as any;
    expect(block.fields).toEqual({ RO: 'TRUE' });
  });

  test('is idempotent and does not mutate its input', () => {
    const once = normalizeState(legacy);
    expect(normalizeState(once)).toEqual(once);
    expect((legacy.blocks.blocks[0] as any).fields.NAME).toBe('a');
  });

  test('upgrades a single block state (append path)', () => {
    const block = normalizeState({ type: 'k8s_deployment', fields: { NAME: 'x' } }) as any;
    expect(block.inputs.NAME.shadow.fields.VALUE).toBe('x');
  });
});

describe('slots', () => {
  const workspace = () => new Blockly.Workspace();

  test('a fresh block has default shadow literals', () => {
    const ws = workspace();
    const block = ws.newBlock('k8s_deployment');
    expect(argValue(block, 'REPLICAS')).toBe(String(SPEC_BY_TYPE.k8s_deployment.args!.find((a) => a.name === 'REPLICAS')!.value));
    ws.dispose();
  });

  test('setArgValue and argValue round-trip', () => {
    const ws = workspace();
    const block = ws.newBlock('k8s_deployment');
    setArgValue(block, 'NAME', 'web');
    expect(argValue(block, 'NAME')).toBe('web');
    ws.dispose();
  });

  test('a literal value block dropped on the socket wins over the shadow', () => {
    const ws = workspace();
    const block = ws.newBlock('k8s_deployment');
    const literal = ws.newBlock('byob_text');
    literal.setFieldValue('x', 'VALUE');
    block.getInput('NAME')!.connection!.connect(literal.outputConnection!);
    expect(argValue(block, 'NAME')).toBe('x');
    setArgValue(block, 'NAME', 'shadow-text');
    expect(argValue(block, 'NAME')).toBe('x');
    literal.dispose();
    expect(argValue(block, 'NAME')).toBe('shadow-text');
    ws.dispose();
  });

  test('appendState upgrades legacy block state', () => {
    const ws = workspace();
    const block = appendState({ type: 'k8s_deployment', fields: { NAME: 'legacy' } }, ws);
    expect(argValue(block, 'NAME')).toBe('legacy');
    ws.dispose();
  });
});

describe('migration keeps every demo and snippet identical', () => {
  const read = (block: Blockly.Block, name: string) => argValue(block, name);
  for (const c of goldenCases()) {
    test(c.name, () => {
      expect(runCase(c, read, loadState)).toEqual(golden(c.name));
    });
  }
});

describe('readers of saved state see shadow literals', () => {
  const dockerSnippet = BUILTIN_SNIPPETS.find((s) => s.name.startsWith('Multi-Stage'))!;
  const legacyFile = (): ProjectFile => ({ id: 'df', name: 'Dockerfile', kind: 'dockerfile', state: wsState(snippetState(dockerSnippet)) } as ProjectFile);

  test('dependency graph is identical for legacy and migrated Dockerfile state', () => {
    const old = legacyFile();
    const migrated = { ...old, state: normalizeState(old.state) };
    const graph = (f: ProjectFile) => { const g = buildDependencyGraph([f], (x) => yamlForFile(x, {})); return { n: g.nodes.map((n) => n.name).sort(), e: g.edges.map((e) => `${e.label}`).sort() }; };
    expect(graph(migrated)).toEqual(graph(old));
    expect(graph(migrated).n).toContain('build');
  });

  test('secret scan finds a password stored in a shadow literal, like in a field', () => {
    const block = { type: 'svc_env', fields: { K: 'POSTGRES_PASSWORD', V: 'hunter2hunter2xyz' } };
    const scan = (state: any) => findSecrets({ block: state } as any).map((h) => h.key);
    expect(scan(normalizeState(block)).length).toBeGreaterThan(0);
    expect(scan(normalizeState(block))).toEqual(scan(block));
  });

  test('checkData accepts literal blocks, counts only real blocks, rejects unknown literal types', () => {
    const state = normalizeState(snippetState(BUILTIN_SNIPPETS.find((s) => s.kind === 'k8s')!));
    const ok = checkData('snippet', { block: state });
    expect(ok.blockCount).toBeGreaterThan(0);
    const bad = JSON.parse(JSON.stringify(state));
    (bad.inputs ??= {}).X = { shadow: { type: 'byob_evil', fields: { VALUE: 'x' } } };
    expect(() => checkData('snippet', { block: bad })).toThrow(/Unbekannte/);
  });

  test('Helm export turns ${VAR} in a slot literal into a chart value', () => {
    const project = openshiftDemo();
    const chart = buildHelmChart(project, { name: 'demo', version: '0.1.0', description: 'x', fileIds: project.files.map((f) => f.id) });
    expect(chart.errors ?? []).toEqual([]);
    expect(chart.files.some((f) => f.content.includes('.Values'))).toBe(true);
  });
});

describe('custom block recipes stay field-based', () => {
  test('denormalizeState is the inverse of normalizeState for recipe blocks', () => {
    const recipe = { type: 'compose_service', fields: { NAME: 'db', IMAGE: 'postgres:16' }, inputs: { BODY: { block: { type: 'svc_restart', fields: { R: 'always' } } } } };
    expect(denormalizeState(normalizeState(recipe))).toEqual(recipe);
  });

  test('a field change on a literal maps back to the owning block and argument', () => {
    const ws = new Blockly.Workspace();
    const block = appendState({ type: 'k8s_deployment', fields: { NAME: 'x' } }, ws);
    const literal = block.getInput('NAME')!.connection!.targetBlock()!;
    expect(ownerOfField(ws, literal.id, 'VALUE')).toEqual({ blockId: block.id, name: 'NAME' });
    expect(ownerOfField(ws, block.id, 'KIND')).toEqual({ blockId: block.id, name: 'KIND' });
    ws.dispose();
  });
});

// ---------- Task 3: evaluator and core value blocks ----------
import YAML from 'yaml';
import { generate } from '../src/blocks/generator';
import type { ValueSession } from '../src/blocks/value';

const session = (patch: Partial<ValueSession> = {}): ValueSession => ({ seed: 7, now: new Date('2026-11-06T12:34:56Z'), envName: 'dev', projectName: 'Demo', fileName: 'a.yaml', ...patch });
const lit = (value: string) => ({ shadow: { type: 'byob_text', fields: { VALUE: value } } });
/** Deployment with the given value block plugged into NAME. */
const deployWith = (block: any, extra: any = {}) => ({ type: 'k8s_deployment', inputs: { NAME: { block } }, ...extra });
function run(state: any, opts: { vars?: Record<string, string>; session?: ValueSession } = {}) {
  const ws = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    loadState(wsState(state), ws);
    const r = generate(ws, opts.vars ?? {}, { session: opts.session ?? session() });
    return { ...r, doc: r.yaml ? YAML.parse(r.yaml.split('---')[0]) : null };
  } finally { Blockly.Events.enable(); ws.dispose(); }
}
const nameOf = (block: any, opts?: Parameters<typeof run>[1]) => run(deployWith(block), opts).doc?.metadata?.name;

describe('value blocks', () => {
  test('same seed gives the same random value, another seed another', () => {
    const block = { type: 'val_random_int', fields: { MIN: '1', MAX: '1000000' } };
    expect(nameOf(block)).toBe(nameOf(block));
    expect(nameOf(block, { session: session({ seed: 8 }) })).not.toBe(nameOf(block));
  });

  test('two random blocks in one export differ', () => {
    const rnd = (key: string) => ({ type: 'val_random_text', fields: { LEN: '12', SET: 'lowerdigits' } });
    const state = deployWith(rnd('a'), { next: { block: { type: 'meta_label', inputs: { K: { block: rnd('k') }, V: { block: rnd('v') } } } } });
    const labels = run(state).doc.metadata.labels;
    const [k, v] = Object.entries(labels)[0];
    expect(k).not.toBe(v);
  });

  test('uuid is a version 4 uuid', () => {
    expect(String(nameOf({ type: 'val_uuid' }))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('timestamp uses the session clock', () => {
    expect(nameOf({ type: 'val_timestamp', fields: { FORMAT: 'compact' } })).toBe('20261106123456');
    expect(nameOf({ type: 'val_timestamp', fields: { FORMAT: 'date' } })).toBe('2026-11-06');
  });

  test('join with a separator, nested', () => {
    const inner = { type: 'val_join', fields: { A: 'x', B: 'y', SEP: '-' } };
    expect(nameOf({ type: 'val_join', inputs: { A: { block: inner }, B: lit('z'), SEP: lit('.') } })).toBe('x-y.z');
  });

  test('if and compare choose by environment', () => {
    const pick = { type: 'val_if', inputs: { COND: { block: { type: 'val_compare', inputs: { A: { block: { type: 'val_env' } }, B: lit('prod') }, fields: { OP: 'eq' } } }, THEN: lit('big'), ELSE: lit('small') } };
    expect(nameOf(pick, { session: session({ envName: 'prod' }) })).toBe('big');
    expect(nameOf(pick, { session: session({ envName: 'dev' }) })).toBe('small');
  });

  test('variable block reads project variables', () => {
    expect(nameOf({ type: 'val_variable', fields: { NAME: 'APP' } }, { vars: { APP: 'shop' } })).toBe('shop');
  });

  test('unknown variable warns on the value block and blocks export', () => {
    const r = run(deployWith({ type: 'val_variable', fields: { NAME: 'NOPE' } }));
    expect(r.blocked).toBe(true);
    expect(r.warnings.some((w) => /NOPE/.test(w.msg))).toBe(true);
  });

  test('inverted random range is an error, not a value', () => {
    const r = run(deployWith({ type: 'val_random_int', fields: { MIN: '9', MAX: '1' } }));
    expect(r.blocked).toBe(true);
  });

  test('a number slot fed text warns like a bad literal', () => {
    const r = run({ type: 'k8s_deployment', fields: { NAME: 'a' }, inputs: { REPLICAS: { block: { type: 'val_random_text', fields: { LEN: '4', SET: 'lower' } } } } });
    expect(r.warnings.some((w) => /keine Zahl/.test(w.msg))).toBe(true);
  });

  test('a number slot accepts a computed number', () => {
    const r = run({ type: 'k8s_deployment', fields: { NAME: 'a' }, inputs: { REPLICAS: { block: { type: 'val_random_int', fields: { MIN: '3', MAX: '3' } } } } });
    expect(r.doc.spec.replicas).toBe(3);
  });

  test('disabled blocks and loose blocks never evaluate (no side effects)', () => {
    const rnd = { type: 'val_random_int', fields: { MIN: '1', MAX: '1000000' } };
    const plain = nameOf(rnd);
    const withDisabled = run({ ...deployWith(rnd), next: { block: { type: 'meta_label', disabled: true, inputs: { K: { block: rnd }, V: { block: rnd } } } } }).doc.metadata.name;
    expect(withDisabled).toBe(plain);
    const ws = new Blockly.Workspace();
    loadState(wsState(deployWith(rnd), { type: 'val_random_int', fields: { MIN: '9', MAX: '1' }, x: 400, y: 400 }), ws);
    const r = generate(ws, {}, { session: session() });
    expect(r.blocked).toBeFalsy();
    ws.dispose();
  });

  test('counters with the same name count up together, different names are separate', () => {
    const counter = (key: string) => ({ type: 'val_counter', fields: { KEY: key, START: '8080' } });
    const state = deployWith(counter('port'), { next: { block: { type: 'meta_label', inputs: { K: { block: counter('port') }, V: { block: counter('other') } } } } });
    const doc = run(state).doc;
    expect(doc.metadata.name).toBe('8080');
    expect(doc.metadata.labels).toEqual({ '8081': '8080' });
  });
});

// ---------- Task 4: sessions per export ----------
import { newSession } from '../src/blocks/value';
import { yamlForFile } from '../src/projectYaml';

describe('export sessions', () => {
  const rndFile = (name: string): ProjectFile => ({ id: name, name, kind: 'k8s', state: wsState(deployWith({ type: 'val_random_text', fields: { LEN: '16', SET: 'lowerdigits' } })) } as ProjectFile);

  test('each export (no session given) draws new values', () => {
    expect(yamlForFile(rndFile('a.yaml'), {})).not.toBe(yamlForFile(rndFile('a.yaml'), {}));
  });

  test('one session gives one file the same values again', () => {
    const s = newSession();
    expect(yamlForFile(rndFile('a.yaml'), {}, s)).toBe(yamlForFile(rndFile('a.yaml'), {}, { ...s, counters: undefined, memo: undefined }));
  });

  test('files of one export share seed and clock but draw different values', () => {
    const s = newSession();
    expect(yamlForFile(rndFile('a.yaml'), {}, s)).not.toBe(yamlForFile(rndFile('b.yaml'), {}, s));
  });

  test('newSession twice gives different seeds', () => {
    expect(newSession().seed).not.toBe(newSession().seed);
  });
});

// ---------- Task 5: full catalogue ----------
import { evalValue, makeEnv } from '../src/blocks/value';
import { VALUE_GROUPS, VALUE_SPECS } from '../src/blocks/values';
import { sha256Hex } from '../src/blocks/sha256';

describe('catalogue', () => {
  const v = (type: string, fields: Record<string, string> = {}) => nameOf({ type, fields });

  test('sha256 and base64 known answers', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(v('val_base64', { TEXT: 'hello' })).toBe('aGVsbG8=');
    expect(v('val_sha256', { TEXT: 'abc' })).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('text blocks', () => {
    expect(v('val_slug', { TEXT: 'Mein App 1' })).toBe('mein-app-1');
    expect(v('val_slug', { TEXT: 'Größe & Maß' })).toBe('groesse-mass');
    expect(v('val_upper', { TEXT: 'abc' })).toBe('ABC');
    expect(v('val_lower', { TEXT: 'ABC' })).toBe('abc');
    expect(v('val_replace', { FIND: 'a', TEXT: 'banana', WITH: 'o' })).toBe('bonono');
    expect(v('val_substring', { TEXT: 'abcdef', FROM: '2', LEN: '3' })).toBe('bcd');
    expect(v('val_repeat', { COUNT: '3', TEXT: 'ab' })).toBe('ababab');
    expect(v('val_length', { TEXT: 'häh' })).toBe('3');
    expect(v('val_urlencode', { TEXT: 'p@ss word/1' })).toBe('p%40ss%20word%2F1');
  });

  test('math blocks', () => {
    expect(v('val_math', { A: '7', OP: 'mod', B: '4' })).toBe('3');
    expect(v('val_math', { A: '6', OP: 'mul', B: '7' })).toBe('42');
    expect(v('val_round', { X: '2.345', DIGITS: '2' })).toBe('2.35');
    expect(v('val_minmax', { A: '3', B: '9', WHICH: 'max' })).toBe('9');
    expect(run(deployWith({ type: 'val_math', fields: { A: '1', OP: 'div', B: '0' } })).blocked).toBe(true);
    expect(run(deployWith({ type: 'val_replace', fields: { FIND: '', TEXT: 'x', WITH: 'y' } })).blocked).toBe(true);
  });

  test('random blocks stay inside their limits', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = session({ seed });
      const port = Number(nameOf({ type: 'val_random_port', fields: { MIN: '8000', MAX: '8010' } }, { session: s }));
      expect(port).toBeGreaterThanOrEqual(8000);
      expect(port).toBeLessThanOrEqual(8010);
      expect(String(nameOf({ type: 'val_random_password', fields: { LEN: '16', SYM: 'FALSE' } }, { session: s }))).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{16}$/);
      expect(['a', 'b', 'c']).toContain(nameOf({ type: 'val_random_pick', fields: { LIST: 'a, b ,c' } }, { session: s }));
      expect(String(nameOf({ type: 'val_random_hex', fields: { BYTES: '8' } }, { session: s }))).toMatch(/^[0-9a-f]{16}$/);
      expect(String(nameOf({ type: 'val_random_color' }, { session: s }))).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(String(v('val_random_password', { LEN: '12', SYM: 'TRUE' }))).toMatch(/^(?=.*[^A-Za-z0-9]).{12}$/);
  });

  test('date offset follows the session clock', () => {
    expect(v('val_date_offset', { DAYS: '1' })).toBe('2026-11-07');
    expect(v('val_date_offset', { DAYS: '-6' })).toBe('2026-10-31');
  });

  test('context blocks', () => {
    expect(v('val_project_name')).toBe('Demo');
    expect(v('val_file_name')).toBe('a.yaml');
  });

  test('remember keeps the first value across files of one export', () => {
    const s = newSession();
    const remembered = (name: string): ProjectFile => ({ id: name, name, kind: 'k8s', state: wsState(deployWith({ type: 'val_remember', fields: { KEY: 'pw' }, inputs: { VALUE: { block: { type: 'val_random_password', fields: { LEN: '12', SYM: 'FALSE' } } } } })) } as ProjectFile);
    const name = (y: string) => YAML.parse(y).metadata.name;
    expect(name(yamlForFile(remembered('a.yaml'), {}, s))).toBe(name(yamlForFile(remembered('b.yaml'), {}, s)));
    expect(name(yamlForFile(remembered('a.yaml'), {}, newSession()))).not.toBe(name(yamlForFile(remembered('a.yaml'), {}, s)));
  });

  test('every value block has a toolbox group, and groups name only real blocks', () => {
    const grouped = VALUE_GROUPS.flatMap((g) => g.types);
    expect([...grouped].sort()).toEqual(VALUE_SPECS.map((s) => s.type).sort());
  });

  test('every value block builds and evaluates with its defaults', () => {
    const ws = new Blockly.Workspace();
    for (const spec of VALUE_SPECS) {
      const block = ws.newBlock(spec.type);
      const problems: string[] = [];
      evalValue(block, makeEnv({}, session(), (m) => problems.push(m)));
      // the variable block defaults to a name that is not defined
      expect(problems).toEqual(spec.type === 'val_variable' ? [expect.stringContaining('nicht definiert')] : []);
    }
    ws.dispose();
  });
});
