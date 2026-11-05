import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deployRelease, preflight } from './deploy-aapanel.mjs';

const ROOT = '/www/wwwroot/byobyaml.keksgames.de';
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'byobyaml-transaction-')); temps.push(temp);
  const releaseDir = join(temp, 'release');
  const remote = join(temp, 'remote');
  const local = (path: string) => join(remote, path);
  const put = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  const files = { 'app/index.html': '<html><script src="/app/assets/main.js"></script><link rel="stylesheet" href="/app/assets/main.css"></html>', 'app/assets/main.js': 'new-app();', 'app/assets/main.css': 'body{color:blue}', 'site/index.html': '<html>new-docs</html>', 'server.mjs': 'new-server();', 'package.json': JSON.stringify({ scripts: { start: 'node server.mjs' } }) };
  for (const [name, body] of Object.entries(files)) put(join(releaseDir, name), body);
  put(join(releaseDir, 'deploy-manifest.json'), JSON.stringify({ tag: 'test-1', files: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')])) }));
  const archive = () => { const result = spawnSync('tar', ['-czf', `${releaseDir}.tar.gz`, '-C', releaseDir, 'app', 'site', 'server.mjs', 'package.json', 'deploy-manifest.json']); if(result.status) throw Error('tar failed'); };
  archive();
  for (const [name, content] of Object.entries({ '.env': 'private-do-not-read', 'app/index.html': 'old-app', 'site/index.html': 'old-docs', 'server.mjs': 'old-server', 'package.json': JSON.stringify({ scripts: { start: 'node server.mjs' } }), 'node_modules/keep': 'dependencies', '.well-known/keep': 'verification', 'uploads/keep': 'user-data' })) put(local(`${ROOT}/${name}`), content);
  put(local('/www/wwwroot/other-project/keep'), 'other-project');
  const state = { running: true, mutationCount: 0, stopCount: 0, startCount: 0, readEnv: false, project: { name: 'byobyaml', path: ROOT, run: true, project_config: { port: 3080, run_user: 'www', nodejs_version: 'v24.13.1' } }, fail: '' };
  const json = (data: unknown, status=200) => Response.json(data, {status});
  const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === 'byobyaml.keksgames.de') {
      if (!state.running) return new Response('down', {status:503});
      if (url.pathname === '/api/health') {
        if (state.fail === 'health' && readFileSync(local(`${ROOT}/server.mjs`), 'utf8') === 'new-server();') return json({ok:false});
        return json({ok:true});
      }
      if (url.pathname === '/api/projects/deploy-probe') {
        expect(options.method).toBe('PUT');
        expect(new Headers(options.headers).get('X-BYOB')).toBe('1');
        return json({}, new Headers(options.headers).get('Origin') === 'https://byobyaml.keksgames.de' ? 401 : 403);
      }
      const path = url.pathname === '/' ? 'site/index.html' : url.pathname === '/app/' ? 'app/index.html' : url.pathname.slice(1);
      return existsSync(local(`${ROOT}/${path}`)) ? new Response(readFileSync(local(`${ROOT}/${path}`))) : new Response('missing', {status:404});
    }
    expect(url.origin).toBe('https://aa.keksgames.de');
    expect(url.searchParams.has('request_token')).toBe(false);
    const form = options.body as FormData | URLSearchParams;
    expect(form.get('request_token')).toMatch(/^[a-f0-9]{32}$/);
    const action = url.searchParams.get('action') || url.pathname.split('/').pop();
    if (['get_project_info', 'stop_project', 'start_project'].includes(action!)) {
      expect(url.pathname).toBe(`/v2/project/nodejs/${action}`);
      expect(JSON.parse(String(form.get('data')))).toEqual({project_name:'byobyaml'});
      if (action === 'get_project_info') return json({status:0,timestamp:1730000000,message:state.project});
      state.mutationCount++;
      if (action === 'stop_project') { state.running=false; state.stopCount++; }
      else { state.startCount++; if(state.fail === 'start' && state.startCount === 1) return json({status:1,timestamp:1730000000,message:'start failed'}); state.running=true; }
      return json({status:0,timestamp:1730000000,message:'operation succeeded'});
    }
    const path = String(form.get('path'));
    if(action === 'GetDir') {
      const entries = readdirSync(local(path), {withFileTypes:true});
      return json({PATH:path, DIR:entries.filter(x=>x.isDirectory()).map(x=>`${x.name};0`), FILES:entries.filter(x=>x.isFile()).map(x=>`${x.name};0`)});
    }
    if(action === 'GetFileBody') { if(path.endsWith('/.env')) state.readEnv=true; return json({status:true, data:readFileSync(local(path),'utf8')}); }
    state.mutationCount++;
    if(action === 'CreateDir') mkdirSync(local(path));
    else if(action === 'UploadFile') {
      if(state.fail === 'upload') return json({status:false,msg:'upload failed'});
      const file = form.get('zunfile') as File; writeFileSync(join(local(path),file.name), Buffer.from(await file.arrayBuffer()));
    } else if(action === 'UnZip') {
      const result = spawnSync('tar', ['-xzf',local(String(form.get('sfile'))),'-C',local(String(form.get('dfile')))]); if(result.status) return json({status:false});
    } else if(action === 'MvFile') {
      const source = String(form.get('sfile')), destination=String(form.get('dfile'));
      renameSync(local(source), local(destination));
      if(state.fail === 'move' && source === `${ROOT}/site`) { state.fail=''; throw Error('lost move response'); }
    } else if(action === 'DeleteFile' || action === 'DeleteDir') rmSync(local(path),{recursive:action === 'DeleteDir'});
    else throw Error(`Unexpected API action ${action}`);
    return json({status:true});
  };
  return { temp, releaseDir, remote, local, state, fetchImpl, archive };
}
function preserved(f: ReturnType<typeof fixture>) {
  expect(f.state.readEnv).toBe(false);
  expect(readFileSync(f.local(`${ROOT}/.env`),'utf8')).toBe('private-do-not-read');
  expect(readFileSync(f.local(`${ROOT}/uploads/keep`),'utf8')).toBe('user-data');
  expect(readFileSync(f.local(`${ROOT}/node_modules/keep`),'utf8')).toBe('dependencies');
  expect(readFileSync(f.local(`${ROOT}/.well-known/keep`),'utf8')).toBe('verification');
  expect(readFileSync(f.local('/www/wwwroot/other-project/keep'),'utf8')).toBe('other-project');
}
const options = (f: ReturnType<typeof fixture>) => ({releaseDir:f.releaseDir, tag:'test-1',key:'test-key',fetchImpl:f.fetchImpl,healthTimeoutMs:15,pollIntervalMs:1,log:()=>{}});

test('activates verified runtime and retains old release while preserving private and unrelated data', async () => {
  const f=fixture(); const result=await deployRelease(options(f));
  expect(readFileSync(f.local(`${ROOT}/app/index.html`),'utf8')).toContain('main.js');
  expect(readFileSync(f.local(`${result.backupPath}/app/index.html`),'utf8')).toBe('old-app');
  expect(f.state.running).toBe(true); expect(f.state.stopCount).toBe(1); preserved(f);
});
test('upload failure leaves previous running release untouched', async () => {
  const f=fixture(); f.state.fail='upload'; await expect(deployRelease(options(f))).rejects.toThrow(/upload/i);
  expect(f.state.stopCount).toBe(0); expect(f.state.running).toBe(true); expect(readFileSync(f.local(`${ROOT}/app/index.html`),'utf8')).toBe('old-app'); preserved(f);
});
for(const failure of ['move','start','health']) test(`${failure} failure restores previous release and service`, async () => {
  const f=fixture(); f.state.fail=failure; await expect(deployRelease(options(f))).rejects.toThrow();
  expect(f.state.running).toBe(true); expect(readFileSync(f.local(`${ROOT}/app/index.html`),'utf8')).toBe('old-app');
  expect(readFileSync(f.local(`${ROOT}/site/index.html`),'utf8')).toBe('old-docs'); expect(readFileSync(f.local(`${ROOT}/server.mjs`),'utf8')).toBe('old-server');
  expect(existsSync(f.local(`${ROOT}/deploy-manifest.json`))).toBe(false); preserved(f);
});
for(const change of [{path:'/www/wwwroot/other-project'},{name:'other-project'},{run:false},{project_config:{port:3090}},{project_config:{run_user:'root'}},{project_config:{nodejs_version:'v22.20.0'}}]) test(`rejects incompatible project ${JSON.stringify(change)} without mutations`,async()=> {
  const f=fixture(); Object.assign(f.state.project,change); await expect(preflight({key:'test-key',fetchImpl:f.fetchImpl})).rejects.toThrow(); expect(f.state.mutationCount).toBe(0); preserved(f);
});
test('rejects unsafe local manifest paths before contacting aaPanel',async()=> {
  const f=fixture(); writeFileSync(join(f.releaseDir,'deploy-manifest.json'),JSON.stringify({tag:'test-1',files:{'../.env':'0'.repeat(64)}})); f.archive();
  await expect(deployRelease(options(f))).rejects.toThrow(/manifest|path/i); expect(f.state.mutationCount).toBe(0);
});
test('empty key fails clearly before mutations',async()=> {
  const f=fixture(); await expect(preflight({key:' ',fetchImpl:f.fetchImpl})).rejects.toThrow(/key/i); expect(f.state.mutationCount).toBe(0);
});

test('a lost activation move response restores all previous runtime files',async()=> {
  const f=fixture(); let lost=false;
  const fetchImpl=async(input: string | URL | Request, options: RequestInit={})=>{
    const response=await f.fetchImpl(input,options);
    if(String(input).includes('action=MvFile') && (options.body as URLSearchParams).get('sfile')===`${ROOT}/.byobyaml-deploy-test-1/new/app` && !lost) { lost=true; throw Error('lost activation response'); }
    return response;
  };
  await expect(deployRelease({...options(f),fetchImpl})).rejects.toThrow(/restored/);
  expect(f.state.running).toBe(true); expect(readFileSync(f.local(`${ROOT}/app/index.html`),'utf8')).toBe('old-app');
  expect(readFileSync(f.local(`${ROOT}/site/index.html`),'utf8')).toBe('old-docs'); preserved(f);
});
test('staged server corruption is detected before stopping the live project',async()=> {
  const f=fixture();
  const fetchImpl=async(input: string | URL | Request, options: RequestInit={})=>{
    const response=await f.fetchImpl(input,options);
    if(String(input).includes('action=UnZip')) writeFileSync(f.local(`${ROOT}/.byobyaml-deploy-test-1/new/server.mjs`),'corrupt-server');
    return response;
  };
  await expect(deployRelease({...options(f),fetchImpl})).rejects.toThrow(/Staged runtime content/);
  expect(f.state.stopCount).toBe(0); expect(f.state.running).toBe(true); preserved(f);
});
test('public asset mismatch rolls back the complete release',async()=> {
  const f=fixture();
  const fetchImpl=async(input: string | URL | Request, options: RequestInit={})=> String(input).startsWith('https://byobyaml.keksgames.de/app/assets/main.js') ? new Response('stale-app();') : f.fetchImpl(input,options);
  await expect(deployRelease({...options(f),fetchImpl})).rejects.toThrow(/restored.*asset differs/);
  expect(f.state.running).toBe(true); expect(readFileSync(f.local(`${ROOT}/app/index.html`),'utf8')).toBe('old-app'); preserved(f);
});
test('unrecognized mutation responses are rejected before the live project is stopped',async()=> {
  const f=fixture();
  const fetchImpl=async(input: string | URL | Request, options: RequestInit={})=> String(input).includes('action=UploadFile') ? Response.json({message:'unrecognized'}) : f.fetchImpl(input,options);
  await expect(deployRelease({...options(f),fetchImpl})).rejects.toThrow(/UploadFile/);
  expect(f.state.stopCount).toBe(0); preserved(f);
});
test('rollback failure retains recovery files and reports their location',async()=> {
  const f=fixture(); f.state.fail='health';
  const fetchImpl=async(input: string | URL | Request, options: RequestInit={})=> {
    if(String(input).endsWith('/stop_project') && f.state.stopCount===1) return Response.json({status:false});
    return f.fetchImpl(input,options);
  };
  await expect(deployRelease({...options(f),fetchImpl})).rejects.toThrow(/Rollback failed.*\.byobyaml-deploy-test-1\/old/);
  expect(readFileSync(f.local(`${ROOT}/.byobyaml-deploy-test-1/old/app/index.html`),'utf8')).toBe('old-app'); preserved(f);
});
test('archive bytes must match the validated release before any remote changes',async()=> {
  const f=fixture(); writeFileSync(join(f.releaseDir,'server.mjs'),'different-archive-content'); f.archive(); writeFileSync(join(f.releaseDir,'server.mjs'),'new-server();');
  await expect(deployRelease(options(f))).rejects.toThrow(/archive differs/); expect(f.state.mutationCount).toBe(0);
});
test('empty modern project config and a serialized compatible config are accepted read-only',async()=> {
  const f=fixture();
  for(const config of [{},JSON.stringify({port:'3080',run_user:'www',nodejs_version:'v26.1.0'})]) {
    Object.assign(f.state.project,{project_config:config}); await preflight({key:'test-key',fetchImpl:f.fetchImpl});
  }
  expect(f.state.mutationCount).toBe(0); preserved(f);
});

test('an existing remote deployment lock prevents overlapping activation',async()=> {
  const f=fixture(); mkdirSync(f.local(`${ROOT}/.byobyaml-deploy-lock`));
  await expect(deployRelease(options(f))).rejects.toThrow();
  expect(f.state.stopCount).toBe(0); expect(f.state.running).toBe(true);
  expect(existsSync(f.local(`${ROOT}/.byobyaml-deploy-test-1`))).toBe(false);
  expect(existsSync(f.local(`${ROOT}/.byobyaml-deploy-lock`))).toBe(true); preserved(f);
});
test('deployment releases its remote lock after a recoverable staging failure',async()=> {
  const f=fixture(); f.state.fail='upload';
  await expect(deployRelease(options(f))).rejects.toThrow();
  f.state.fail=''; await deployRelease(options(f));
  expect(existsSync(f.local(`${ROOT}/.byobyaml-deploy-lock`))).toBe(false); expect(f.state.running).toBe(true);
});
