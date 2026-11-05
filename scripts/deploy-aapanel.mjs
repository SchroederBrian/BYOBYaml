import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PANEL = 'https://aa.keksgames.de';
const PUBLIC = 'https://byobyaml.keksgames.de';
const ROOT = '/www/wwwroot/byobyaml.keksgames.de';
const RUNTIME = ['app', 'site', 'server.mjs', 'package.json', 'deploy-manifest.json'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const names = listing => [...listing.directories, ...listing.files];
const isFailure = value => value === false || value === 0 || value === '0' || (typeof value === 'string' && value.toLowerCase() === 'false');
const isSuccess = value => value === true || value === 1 || value === '1' || value === 'true';

function validateTarget(key) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('aaPanel API key is empty; fill .aapanel-api-key or set AAPANEL_API_KEY_FILE.');
  for (const [name, expected] of [['AAPANEL_URL', PANEL], ['AAPANEL_SITE_ROOT', ROOT], ['BYOBYAML_URL', PUBLIC]]) {
    if (process.env[name] && process.env[name].replace(/\/$/, '') !== expected) throw new Error(`Refusing alternate deployment target in ${name}`);
  }
}
function transport(key, fetchImpl) {
  validateTarget(key);
  async function call(action, fields = {}, upload) {
    const request_time = String(Math.floor(Date.now() / 1000));
    const auth = { request_time, request_token: md5(request_time + md5(key.trim())) };
    const body = upload ? new FormData() : new URLSearchParams();
    for (const [name, value] of Object.entries({ ...auth, ...fields })) body.append(name, String(value));
    if (upload) body.append('zunfile', new Blob([upload.bytes]), upload.name);
    const endpoint = action.startsWith('/v2/project/') ? action : `/files?action=${action}`;
    let response;
    try { response = await fetchImpl(`${PANEL}${endpoint}`, { method: 'POST', body, signal: AbortSignal.timeout(upload ? 120000 : 30000), redirect: 'error' }); }
    catch { throw new Error(`aaPanel ${action} request failed`); }
    if (!response.ok) throw new Error(`aaPanel ${action} returned HTTP ${response.status}`);
    let data;
    try { data = await response.json(); } catch { throw new Error(`aaPanel ${action} returned invalid JSON`); }
    if (action.startsWith('/v2/project/')) {
      if (data?.status !== 0 || data.timestamp == null || !Object.hasOwn(data, 'message')) throw new Error(`aaPanel ${action} failed`);
      return data.message;
    }
    if (isFailure(data) || isFailure(data?.status)) throw new Error(`aaPanel ${action} failed`);
    if (!['GetDir', 'GetFileBody', '/v2/project/nodejs/get_project_info'].includes(action) && !isSuccess(data) && !isSuccess(data?.status)) throw new Error(`aaPanel ${action} did not confirm success`);
    return data;
  }
  return {
    call,
    async list(path) {
      const data = await call('GetDir', {path});
      if (data?.PATH !== path || !Array.isArray(data.DIR) || !Array.isArray(data.FILES)) throw new Error(`Invalid aaPanel directory listing: ${path}`);
      const entries = array => array.map(entry => {
        if (typeof entry !== 'string') throw new Error('Invalid aaPanel directory entry');
        const name = entry.split(';', 1)[0];
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('Unsafe aaPanel directory entry');
        return name;
      });
      return {directories: entries(data.DIR), files: entries(data.FILES)};
    },
    async read(path) {
      const data = await call('GetFileBody', {path});
      if (!isSuccess(data?.status) || typeof data.data !== 'string') throw new Error(`Unable to read runtime file: ${path}`);
      return data.data;
    },
    mkdir: path => call('CreateDir', {path}),
    move: (sfile, dfile) => call('MvFile', {sfile, dfile, rename:'true'}),
    remove: (path, directory) => call(directory ? 'DeleteDir' : 'DeleteFile', {path}),
    project: action => call(`/v2/project/nodejs/${action}`, {data:JSON.stringify({project_name:'byobyaml'})}),
  };
}
async function inspectProject(api) {
  const project = await api.project('get_project_info');
  if (project?.name !== 'byobyaml' || project?.path !== ROOT || !isSuccess(project?.run)) throw new Error('Expected the running byobyaml project at its fixed site path');
  let config = project.project_config;
  if (typeof config === 'string') { try { config = JSON.parse(config); } catch { throw new Error('Invalid byobyaml project configuration'); } }
  if (config != null && (typeof config !== 'object' || Array.isArray(config))) throw new Error('Invalid byobyaml project configuration');
  config ||= {};
  if (config.port != null && Number(config.port) !== 3080) throw new Error('Unexpected byobyaml port; expected 3080');
  if (config.run_user != null && config.run_user !== 'www') throw new Error('Unexpected byobyaml runtime user; expected www');
  if (config.nodejs_version != null && !/^v?(?:2[4-9]|[3-9]\d|\d{3,})\.\d+\.\d+$/.test(config.nodejs_version)) throw new Error('byobyaml requires Node 24 or newer');
  const listing = await api.list(ROOT);
  if (!['.env', 'server.mjs', 'package.json'].every(name => listing.files.includes(name)) || !['app','site'].every(name => listing.directories.includes(name))) throw new Error('Existing byobyaml runtime is incomplete');
  let pkg; try { pkg = JSON.parse(await api.read(`${ROOT}/package.json`)); } catch { throw new Error('Unable to validate existing byobyaml package.json'); }
  if (pkg.scripts?.start !== 'node server.mjs') throw new Error('Existing byobyaml start command must be node server.mjs');
  return listing;
}
export async function preflight({key, fetchImpl = fetch} = {}) {
  const api = transport(key, fetchImpl);
  await inspectProject(api);
  return {projectName:'byobyaml', siteRoot:ROOT};
}
function safeRuntimePath(path) {
  return typeof path === 'string' && !path.includes('\\') && path.split('/').every(part => /^[A-Za-z0-9_.@+~-]+$/.test(part) && part !== '.' && part !== '..') && (path === 'server.mjs' || path === 'package.json' || /^(app|site)\/.+/.test(path));
}
function walk(directory, prefix = '') {
  const result = [];
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error(`Unsupported runtime file: ${path}`);
    if (entry.isDirectory()) result.push(...walk(join(directory,entry.name), `${path}/`));
    else result.push(path);
  }
  return result;
}
function validateRelease(releaseDir, tag, archivePath) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(tag) || tag.includes('..')) throw new Error('Expected a safe deployment tag');
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(releaseDir,'deploy-manifest.json'),'utf8')); } catch { throw new Error('Missing or invalid release manifest'); }
  if (manifest.tag !== tag || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Invalid release manifest');
  const paths = Object.keys(manifest.files);
  if (!['app/index.html','site/index.html','server.mjs','package.json'].every(path => paths.includes(path))) throw new Error('Release manifest is missing required runtime files');
  for (const path of paths) if (!safeRuntimePath(path) || !/^[a-f0-9]{64}$/.test(manifest.files[path])) throw new Error('Unsafe manifest path or hash');
  const actual = walk(releaseDir).sort();
  const expected = [...paths,'deploy-manifest.json'].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) || readdirSync(releaseDir).sort().join() !== [...RUNTIME].sort().join()) throw new Error('Release contains files outside its manifest');
  for (const name of ['app','site']) if (!lstatSync(join(releaseDir,name)).isDirectory()) throw new Error('Release runtime directory is invalid');
  const bytes = Object.fromEntries(expected.map(path => [path,readFileSync(join(releaseDir,path))]));
  for (const path of paths) if (sha256(bytes[path]) !== manifest.files[path]) throw new Error(`Release hash differs: ${path}`);
  if (JSON.parse(bytes['package.json'].toString()).scripts?.start !== 'node server.mjs') throw new Error('Release must start with node server.mjs');
  // Reject links, duplicates, traversal, and unlisted archive members before extraction.
  const listing = spawnSync('tar',['-tzf',archivePath],{encoding:'utf8',maxBuffer:16*1024*1024});
  const verbose = spawnSync('tar',['-tvzf',archivePath],{encoding:'utf8',maxBuffer:16*1024*1024});
  if (listing.status !== 0 || verbose.status !== 0) throw new Error('Unable to inspect release archive');
  const members = listing.stdout.trimEnd().split(/\r?\n/);
  if (new Set(members).size !== members.length || verbose.stdout.trimEnd().split(/\r?\n/).some(line => !['-','d'].includes(line[0]))) throw new Error('Unsafe release archive members');
  for (const member of members) {
    const path = member.replace(/\/$/,'');
    if (member.endsWith('/')) {
      if (!['app','site'].includes(path) && !safeRuntimePath(path)) throw new Error('Unsafe release archive directory');
    } else if (!expected.includes(path)) throw new Error('Release archive contains an unlisted path');
  }
  if (expected.some(path => !members.includes(path))) throw new Error('Release archive is incomplete');
  const extracted = mkdtempSync(join(tmpdir(),'byobyaml-archive-'));
  try {
    if (spawnSync('tar',['-xzf',archivePath,'-C',extracted]).status !== 0) throw new Error('Unable to validate release archive');
    for (const path of expected) if (!readFileSync(join(extracted,path)).equals(bytes[path])) throw new Error(`Release archive differs: ${path}`);
  } finally { rmSync(extracted,{recursive:true,force:true}); }
  return {bytes,manifest,archive:readFileSync(archivePath)};
}
async function requestPublic(fetchImpl, path, options = {}, timeout = 15000) {
  try { return await fetchImpl(`${PUBLIC}${path}`, {headers:{'Cache-Control':'no-cache'}, ...options, redirect:'error', credentials:'omit', signal:AbortSignal.timeout(Math.max(1,timeout))}); }
  catch { throw new Error(`Public verification request failed: ${path}`); }
}
async function verifyPublic(fetchImpl, expected, healthTimeoutMs, pollIntervalMs, assets = false) {
  const deadline = Date.now() + healthTimeoutMs;
  while (true) {
    try {
      const health = await requestPublic(fetchImpl,'/api/health',{},Math.min(15000,Math.max(1,deadline-Date.now())));
      if (!health.ok || (await health.json()).ok !== true) throw new Error('Health response is not healthy');
      break;
    } catch {
      if (Date.now() >= deadline) throw new Error('byobyaml health verification timed out');
      await new Promise(resolve => setTimeout(resolve,Math.min(pollIntervalMs,Math.max(1,deadline-Date.now()))));
    }
  }
  for (const [path, body] of [['/app/',expected['app/index.html']],['/',expected['site/index.html']]]) {
    const response = await requestPublic(fetchImpl,path);
    if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(Buffer.from(body))) throw new Error(`Public runtime differs: ${path}`);
  }
  if (assets) {
    const html = expected['app/index.html'].toString();
    for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) {
      const url = new URL(match[1],`${PUBLIC}/app/`);
      if (url.origin !== PUBLIC || !url.pathname.startsWith('/app/')) throw new Error('Application asset is outside its release');
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!expected[key]) throw new Error('Application references an unlisted asset');
      const response = await requestPublic(fetchImpl,url.pathname+url.search);
      if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(expected[key])) throw new Error('Public application asset differs');
    }
  }
  for (const [origin,status] of [[PUBLIC,401],['https://evil.invalid',403]]) {
    const response = await requestPublic(fetchImpl,'/api/projects/deploy-probe',{method:'PUT',headers:{Origin:origin,'X-BYOB':'1','Content-Type':'application/json'},body:'{}'});
    if (response.status !== status) throw new Error(`Anonymous project write guard failed (expected ${status})`);
  }
}
async function verifyStage(api, base, release) {
  const tree = [];
  async function visit(path,prefix='') {
    const list = await api.list(path);
    for (const file of list.files) tree.push(prefix+file);
    for (const dir of list.directories) {
      const relative=prefix+dir;
      if (!['app','site'].includes(relative) && !safeRuntimePath(relative)) throw new Error('Unexpected staged runtime directory');
      await visit(`${path}/${dir}`,relative+'/');
    }
  }
  await visit(base);
  if (JSON.stringify(tree.sort()) !== JSON.stringify(Object.keys(release.bytes).sort())) throw new Error('Staged runtime files differ from manifest');
  for (const path of ['server.mjs','package.json','app/index.html','site/index.html','deploy-manifest.json']) {
    const actual = await api.read(`${base}/${path}`), expected = release.bytes[path].toString('utf8');
    if (actual !== expected) throw new Error(`Staged runtime content differs: ${path} (${actual.length} read / ${expected.length} expected characters)`);
  }
}
export async function deployRelease({releaseDir,tag,key,fetchImpl=fetch,healthTimeoutMs=60000,pollIntervalMs=1000,log=console.log,archivePath=`${releaseDir}.tar.gz`}) {
  validateTarget(key);
  if (!Number.isFinite(healthTimeoutMs) || healthTimeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw new Error('Expected positive verification timeouts');
  const release = validateRelease(releaseDir,tag,archivePath);
  const api = transport(key,fetchImpl);
  await inspectProject(api);
  const lock = `${ROOT}/.byobyaml-deploy-lock`;
  try { await api.mkdir(lock); } catch { throw new Error(`Cannot acquire remote deployment lock at ${lock}; another deployment may be running. If a previous deployment was interrupted, inspect its recovery files before clearing the lock.`); }
  let verified = false;
  try {
  // Recheck after acquiring the lock: another deployment may have finished since preflight.
  const root = await inspectProject(api);
  const stage = `${ROOT}/.byobyaml-deploy-${tag}`;
  if (names(root).includes(stage.slice(ROOT.length+1))) throw new Error('Deployment staging path already exists');
  const previous = {'app/index.html':await api.read(`${ROOT}/app/index.html`),'site/index.html':await api.read(`${ROOT}/site/index.html`)};
  const hadManifest = root.files.includes('deploy-manifest.json');
  let stageCreated=false, stopAttempted=false, activationStarted=false;
  try {
    await api.mkdir(stage); stageCreated=true;
    await api.mkdir(`${stage}/new`); await api.mkdir(`${stage}/old`);
    await api.call('UploadFile',{path:stage},{bytes:release.archive,name:'release.tar.gz'});
    await api.call('UnZip',{sfile:`${stage}/release.tar.gz`,dfile:`${stage}/new`,password:''});
    await verifyStage(api,`${stage}/new`,release);
    log('Verified staged byobyaml release');
    stopAttempted=true;
    await api.project('stop_project');
    for (const name of RUNTIME) if (names(root).includes(name)) await api.move(`${ROOT}/${name}`,`${stage}/old/${name}`);
    activationStarted=true;
    for (const name of RUNTIME) await api.move(`${stage}/new/${name}`,`${ROOT}/${name}`);
    await api.project('start_project');
    await verifyPublic(fetchImpl,release.bytes,healthTimeoutMs,pollIntervalMs,true);
    log(`Verified byobyaml release; previous runtime retained at ${stage}/old`);
    verified = true;
    return {backupPath:`${stage}/old`};
  } catch (error) {
    if (!stopAttempted) {
      if (stageCreated) await api.remove(stage,true).catch(()=>{});
      throw error;
    }
    try {
      // A timed-out move may already have completed: the backup listing is authoritative.
      await api.project('stop_project');
      const old = await api.list(`${stage}/old`);
      if (names(old).some(name=>!RUNTIME.includes(name))) throw new Error('Unexpected backup entry');
      for (const name of names(old)) {
        const live = await api.list(ROOT);
        if (names(live).includes(name)) await api.remove(`${ROOT}/${name}`,live.directories.includes(name));
        await api.move(`${stage}/old/${name}`,`${ROOT}/${name}`);
      }
      if (activationStarted && !hadManifest) {
        const live = await api.list(ROOT);
        if (live.files.includes('deploy-manifest.json')) await api.remove(`${ROOT}/deploy-manifest.json`,false);
      }
      await api.project('start_project');
      await verifyPublic(fetchImpl,previous,healthTimeoutMs,pollIntervalMs);
      log('Restored and verified previous byobyaml release');
    } catch (rollbackError) {
      throw new Error(`Deployment failed: ${error.message}. Rollback failed: ${rollbackError.message}. Keep recovery files at ${stage}/old.`);
    }
    throw new Error(`Deployment failed; previous release restored: ${error.message}`);
  }
  } finally {
    try { await api.remove(lock,true); } catch {
      if (verified) throw new Error(`Release verified, but remote deployment lock could not be removed: ${lock}`);
      log(`Remote deployment lock needs inspection before retrying: ${lock}`);
    }
  }
}

async function cli() {
  let key = process.env.AAPANEL_API_KEY;
  if (key == null) {
    const keyPath = process.env.AAPANEL_API_KEY_FILE || resolve(dirname(fileURLToPath(import.meta.url)),'../.aapanel-api-key');
    try { key=readFileSync(keyPath,'utf8').trim(); } catch { throw new Error('Cannot read aaPanel API key file; fill .aapanel-api-key or set AAPANEL_API_KEY_FILE'); }
  }
  const [mode,releaseDir,tag] = process.argv.slice(2);
  if (mode === 'preflight') { await preflight({key}); console.log('Verified existing byobyaml project and runtime'); }
  else if(mode === 'deploy' && releaseDir && tag) await deployRelease({releaseDir,tag,key});
  else throw new Error('Usage: bun scripts/deploy-aapanel.mjs preflight | deploy RELEASE_DIR TAG');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error=>{console.error(error.message);process.exitCode=1;});
