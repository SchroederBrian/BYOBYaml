import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWebSource } from './prepare-web-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
const webRef = process.argv[3] || 'deploy/aapanel';
if (!tag || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(tag) || tag.includes('..')) throw new Error('Expected a safe release tag');
const output = join(root, '.deploy-build', tag);
if (existsSync(output)) throw new Error('Release output already exists; use a fresh tag');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'byobyaml-build-'));
const source = join(temporary, 'source');
const release = join(output, 'release');
const env = { ...process.env };
delete env.AAPANEL_API_KEY;
const run = (command, args, cwd = source, patch = {}) => execFileSync(command, args, { cwd, env: { ...env, ...patch }, stdio: 'inherit' });

try {
  const provenance = prepareWebSource({ repoRoot: root, destination: source, webRef });
  console.log(`Building current editor with web source ${provenance.webCommit.slice(0, 8)}`);
  run('bun', ['install', '--frozen-lockfile', '--ignore-scripts']);
  // This runs the normal typecheck + Vite build, using the web branch's config.
  run('bun', ['run', 'build'], source, { VITE_SERVER: '1', VITE_BASE: '/app/', VITE_OUT_DIR: join(release, 'app') });
  run('bun', ['scripts/gen-docs.ts']);
  run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], join(source, 'docs-site'));
  run('bun', ['run', 'build', '--out-dir', join(release, 'site')], join(source, 'docs-site'));
  run('bun', ['build', 'server/index.ts', '--target=node', '--format=esm', '--minify', `--outfile=${join(release, 'server.mjs')}`]);
  run('node', ['--check', join(release, 'server.mjs')]);
  writeFileSync(join(release, 'package.json'), JSON.stringify({ name: 'byobyaml-server', private: true, type: 'module', main: 'server.mjs', scripts: { start: 'node server.mjs' } }, null, 2) + '\n');
  for (const required of ['app/index.html', 'site/index.html', 'server.mjs']) if (!existsSync(join(release, required))) throw new Error(`Build is missing ${required}`);

  const files = {};
  function hashDirectory(directory, prefix = '') {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + item.name;
      if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) throw new Error(`Unsupported release entry: ${path}`);
      if (item.isDirectory()) hashDirectory(join(directory, item.name), path + '/');
      else files[path] = createHash('sha256').update(readFileSync(join(directory, item.name))).digest('hex');
    }
  }
  hashDirectory(release);
  const manifest = { tag, ...provenance, builtAt: new Date().toISOString(), runtime: 'node', files };
  writeFileSync(join(release, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  run('tar', ['-C', release, '-czf', `${release}.tar.gz`, 'app', 'site', 'server.mjs', 'package.json', 'deploy-manifest.json']);
  copyFileSync(join(release, 'deploy-manifest.json'), join(output, 'manifest.json'));
  // A built, versioned artifact is reusable without leaving source/node_modules behind.
  console.log(`Built ${Object.keys(files).length} runtime files: ${release}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
