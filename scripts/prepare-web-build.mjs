// Combine the working editor with the web branch without changing the checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const normal = (bytes) => bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
const same = (a, b) => normal(a).equals(normal(b));
const read = (file) => existsSync(file) ? readFileSync(file) : null;

export function prepareWebSource({ repoRoot, destination, webRef = 'deploy/aapanel' }) {
  repoRoot = resolve(repoRoot);
  destination = resolve(destination);
  if (existsSync(destination)) throw new Error(`Build destination already exists: ${destination}`);
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  const webCommit = git('rev-parse', '--verify', '--end-of-options', `${webRef}^{commit}`).trim();
  const base = git('merge-base', 'HEAD', webCommit).trim();
  const scratch = mkdtempSync(join(tmpdir(), 'byobyaml-source-'));
  const baseDir = join(scratch, 'base');
  mkdirSync(destination, { recursive: true });
  mkdirSync(baseDir);
  try {
    for (const [ref, target, name] of [[webCommit, destination, 'web'], [base, baseDir, 'base']]) {
      const archive = join(scratch, `${name}.tar`);
      git('archive', '--format=tar', `--output=${archive}`, ref);
      execFileSync('tar', ['-xf', archive, '-C', target]);
    }

    const sourcePaths = ['src', 'docs-site', 'public', 'server', 'index.html', 'vite.config.ts', 'tsconfig.json', 'scripts/gen-docs.ts', 'scripts/variable-scopes.test.ts'];
    const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sourcePaths).split('\0').filter(Boolean))];
    for (const path of paths) {
      // Nextcloud conflict backups are not application sources.
      if (/ \(conflicted copy [^)]+\)\.[^/]+$/.test(path)) continue;
      if (path.split('/').some((part) => ['node_modules', '.docusaurus', 'build', '.env', '.env.local'].includes(part))) continue;
      const local = read(join(repoRoot, path));
      const ancestor = read(join(baseDir, path));
      const web = read(join(destination, path));
      if (!local) {
        if (!ancestor) continue; // web-only sources, including AuthGate and server
        if (web && !same(web, ancestor)) throw new Error(`Merge conflict in deleted ${path}; resolve it before deployment.`);
        rmSync(join(destination, path), { force: true });
        continue;
      }
      if (ancestor && same(local, ancestor)) continue;
      if (web && same(local, web)) continue;
      let merged = local;
      if (web && (!ancestor || !same(web, ancestor))) {
        if ([local, web, ancestor ?? Buffer.alloc(0)].some((bytes) => bytes.includes(0))) throw new Error(`Binary merge conflict in ${path}`);
        const ours = join(scratch, 'ours');
        const theirs = join(scratch, 'theirs');
        const common = join(scratch, 'common');
        writeFileSync(ours, normal(local));
        writeFileSync(theirs, normal(web));
        writeFileSync(common, normal(ancestor ?? Buffer.alloc(0)));
        // Keep current editor changes on overlapping shared-source lines.
        // Platform-specific login/storage/entrypoint conflicts must be resolved
        // explicitly; independent web additions are merged normally.
        const platformFiles = ['src/storage.ts', 'src/main.tsx', 'src/components/AuthGate.tsx', 'vite.config.ts'];
        const sharedSource = path.startsWith('src/') || path.startsWith('docs-site/docs/');
        const preference = sharedSource && !platformFiles.includes(path) ? ['--ours'] : [];
        const result = spawnSync('git', ['merge-file', '-p', '--diff3', ...preference, ours, common, theirs], { maxBuffer: 32 * 1024 * 1024 });
        if (result.status !== 0) throw new Error(`Merge conflict in ${path}; resolve it before deployment. No live files changed.`);
        merged = result.stdout;
      }
      if (path === 'src/App.tsx' && web) {
        // The desktop editor does not import web authentication. Keep these
        // web-only imports when --ours resolves a shared import-block conflict.
        let app = merged.toString('utf8');
        const authImport = web.toString('utf8').match(/^import[^\n]+from ['"]\.\/components\/AuthGate['"];?\r?$/m)?.[0];
        if (authImport && !/^import[^\n]+from ['"]\.\/components\/AuthGate['"]/m.test(app)) app = authImport + '\n' + app;
        if (authImport && !/\|\s*\{\s*kind:\s*['"]account['"]/.test(app)) app = app.replace(/type Dialog =\r?\n/, "type Dialog =\n  | { kind: 'account' }\n");
        if (authImport && !/\buseAuth\s*\(/.test(app)) app = app.replace(/export default function App\(\)\s*\{/, '$&\n  const { user } = useAuth();');
        const accountButton = web.toString('utf8').match(/\{user && \([\s\S]*?\n\s*\)\}/)?.[0];
        if (accountButton && !/className=['"]user-btn['"]/.test(app)) {
          const guestAwareButton = /const guest\s*=/.test(app) ? accountButton.replace('{user &&', '{!guest && user &&') : accountButton;
          app = app.replace('<div className="title-right">', '<div className="title-right">\n' + guestAwareButton);
        }
        if (/\bisServer\b/.test(app) && !/^import[^\n]*\bisServer\b[^\n]*from ['"]\.\/storage['"]/m.test(app)) app = "import { isServer } from './storage';\n" + app;
        if (authImport) app = app.replace('const canManageCustomBlocks: boolean = false;', 'const canManageCustomBlocks: boolean = !!user && !guest;');
        merged = Buffer.from(app);
      }
      mkdirSync(dirname(join(destination, path)), { recursive: true });
      writeFileSync(join(destination, path), merged);
    }

    const serverEntry = join(destination, 'server/index.ts');
    if (existsSync(join(destination, 'server/custom-blocks.ts')) && existsSync(serverEntry)) {
      let server = readFileSync(serverEntry, 'utf8');
      if (!server.includes("from './custom-blocks'")) {
        server = "import { mountCustomBlocks, CUSTOM_BLOCK_TABLES } from './custom-blocks';\n" + server;
        // the web branch may list more migrations after MARKET_TABLES (e.g. GitHub tables)
        const migrations = /\[\.\.\.stmts, \.\.\.MARKET_TABLES(?=[,\]])/;
        if (!migrations.test(server)) throw new Error('Cannot locate custom-block database migration insertion point');
        server = server.replace(migrations, '$&, ...CUSTOM_BLOCK_TABLES');
        const anchor = "// ---------- marketplace";
        if (!server.includes(anchor)) throw new Error('Cannot locate authenticated custom-block route insertion point');
        server = server.replace(anchor, "  mountCustomBlocks(api, { pool, requireUser });\n\n" + anchor);
        writeFileSync(serverEntry, server);
      }
    }
    if (existsSync(join(destination,'server/images.ts')) && existsSync(serverEntry)) {
      let server=readFileSync(serverEntry,'utf8');
      if(!server.includes("from './images'")) {
        server="import { mountImageBrowser } from './images';\n"+server;
        const anchor='// ---------- marketplace';
        if(!server.includes(anchor))throw new Error('Cannot locate image browser route insertion point');
        server=server.replace(anchor,'mountImageBrowser(api);\n\n'+anchor);
        const cors="market(\\/|$)|auth";
        if(!server.includes(cors))throw new Error('Cannot locate public image browser CORS insertion point');
        server=server.replace(cors,"market(\\/|$)|images(\\/|$)|auth");
        writeFileSync(serverEntry,server);
      }
    }
    const marketEntry = join(destination, 'server/market.ts');
    if (existsSync(marketEntry)) {
      const market = readFileSync(marketEntry, 'utf8').replace("target === 'compose' || target === 'k8s'", "target === 'compose' || target === 'k8s' || target === 'dockerfile'");
      writeFileSync(marketEntry, market);
    }
    // Web dependencies (auth, database, fonts) must survive desktop-only removals.
    const webPackage = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'));
    const localPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    for (const group of ['dependencies', 'devDependencies']) webPackage[group] = { ...webPackage[group], ...localPackage[group] };
    writeFileSync(join(destination, 'package.json'), JSON.stringify(webPackage, null, 2) + '\n');
    return { webCommit, baseCommit: base, editorCommit: git('rev-parse', 'HEAD').trim() };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [repoRoot, destination, webRef] = process.argv.slice(2);
    if (!repoRoot || !destination) throw new Error('Usage: prepare-web-build.mjs REPOSITORY DESTINATION [WEB_REF]');
    const result = prepareWebSource({ repoRoot, destination, webRef });
    writeFileSync(join(destination, '.build-source.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`Prepared current editor with web source ${result.webCommit.slice(0, 8)} (checkout unchanged).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
