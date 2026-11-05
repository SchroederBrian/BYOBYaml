import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as preparation from './prepare-web-build.mjs';

function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'byob-web-merge-test-'));
  const repo = join(temp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  const app = '// shared editor\n' + Array.from({ length: 12 }, (_, i) => `// line ${i}\n`).join('') + '// variables\n';
  writeFileSync(join(repo, 'src/App.tsx'), app);
  writeFileSync(join(repo, 'src/storage.ts'), '// base version\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { blockly: '1' } }));
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base');
  git('checkout', '-b', 'aapanel');
  writeFileSync(join(repo, 'src/App.tsx'), app.replace('// shared editor', '// web authentication').replace('// variables', '// explorer variables'));
  writeFileSync(join(repo, 'src/storage.ts'), '// web version\n');
  writeFileSync(join(repo, 'src/AuthGate.tsx'), '// keep web login\n');
  mkdirSync(join(repo, 'server'));
  writeFileSync(join(repo, 'server/index.ts'), '// fixed origin check\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { blockly: '1', express: '5' } }));
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'web variant');
  git('checkout', 'main');
  return { temp, repo, git, app, out: join(temp, 'build') };
}

test('combines current editor updates with web login without switching or cleaning the checkout', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'src/App.tsx'), f.app.replace('// variables', '// local and global variables'));
    writeFileSync(join(f.repo, 'src/Explorer.tsx'), '// uncommitted explorer\n');
    const original = readFileSync(join(f.repo, 'src/App.tsx'), 'utf8');
    const result = preparation.prepareWebSource({ repoRoot: f.repo, destination: f.out, webRef: 'aapanel' });
    const app = readFileSync(join(f.out, 'src/App.tsx'), 'utf8');
    expect(app).toContain('// web authentication');
    expect(app).toContain('// local and global variables');
    expect(readFileSync(join(f.out, 'src/AuthGate.tsx'), 'utf8')).toBe('// keep web login\n');
    expect(readFileSync(join(f.out, 'server/index.ts'), 'utf8')).toBe('// fixed origin check\n');
    expect(readFileSync(join(f.out, 'src/Explorer.tsx'), 'utf8')).toBe('// uncommitted explorer\n');
    expect(JSON.parse(readFileSync(join(f.out, 'package.json'), 'utf8')).dependencies.express).toBe('5');
    expect(f.git('branch', '--show-current')).toBe('main');
    expect(readFileSync(join(f.repo, 'src/App.tsx'), 'utf8')).toBe(original);
    expect(result.webCommit).toMatch(/^[a-f0-9]{40}$/);
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});

test('stops on conflicting edits before producing a deployable build', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'src/storage.ts'), '// incompatible desktop change\n');
    expect(() => preparation.prepareWebSource({ repoRoot: f.repo, destination: f.out, webRef: 'aapanel' })).toThrow(/conflict.*src\/storage.ts/i);
    expect(f.git('branch', '--show-current')).toBe('main');
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});

test('does not copy credentials, build outputs, or private YAML samples into the web source', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, '.aapanel-api-key'), 'test-key-must-not-travel');
    mkdirSync(join(f.repo, 'scripts/samples-private'), { recursive: true });
    writeFileSync(join(f.repo, 'scripts/samples-private/private.yaml'), 'private: true');
    preparation.prepareWebSource({ repoRoot: f.repo, destination: f.out, webRef: 'aapanel' });
    expect(() => readFileSync(join(f.out, '.aapanel-api-key'))).toThrow();
    expect(() => readFileSync(join(f.out, 'scripts/samples-private/private.yaml'))).toThrow();
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});
