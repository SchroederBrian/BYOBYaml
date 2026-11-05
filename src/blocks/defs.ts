// All BYOBYaml blocks. Each block = look (msg/args) + what it writes into the YAML (gen).
import YAML, { Scalar } from 'yaml';
import { at, BlockSpec, C, Ctx, D, deepMerge, list, M, N, portVal, setPath, splitArgs, T } from './types';

const POD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'];

function newDoc(ctx: Ctx, apiVersion: string, kind: string, name: string, spec?: any) {
  const doc: any = { apiVersion, kind, metadata: { name: name || 'unbenannt' } };
  if (spec !== undefined) doc.spec = spec;
  ctx.out.push(doc);
  return doc;
}

function podTemplate(app: string) {
  return { metadata: { labels: { app } }, spec: { containers: [] as any[] } };
}

function checkContainers(ctx: Ctx, pod: any, name: string) {
  if (!pod.containers?.length) ctx.warn(`"${name}" hat noch keinen Container-Block.`);
}

// =====================================================================
// DOCKER COMPOSE
// =====================================================================
const compose: BlockSpec[] = [
  {
    type: 'compose_file',
    cat: 'compose',
    shape: 'hat',
    msg: 'Docker Compose · Projekt %1 Version %2',
    args: [T('NAME', ''), T('VERSION', '')],
    tip: 'Startblock für eine docker-compose.yml. Hänge Services, Volumes und Netzwerke darunter.',
    gen: (v, ctx, run) => {
      const doc: any = {};
      if (v.VERSION) doc.version = v.VERSION;
      if (v.NAME) doc.name = v.NAME;
      doc.services = {};
      doc.volumes = undefined;
      doc.networks = undefined;
      doc.secrets = undefined;
      ctx.out.push(doc);
      run(['compose'], { doc, target: doc });
      if (!Object.keys(doc.services).length) ctx.warn('Compose-Datei hat noch keinen Service.');
    },
  },
  {
    type: 'compose_service',
    cat: 'compose',
    shape: 'c',
    msg: 'Service %1 Image %2',
    args: [T('NAME', 'web'), T('IMAGE', 'nginx:latest')],
    scope: ['compose'],
    where: 'unter einen "Docker Compose"-Startblock',
    tip: 'Ein Container-Service. Lege Service-Blöcke (lila) hinein.',
    gen: (v, ctx, run) => {
      const svc: any = {};
      if (v.IMAGE) svc.image = v.IMAGE;
      ctx.doc.services[v.NAME || 'service'] = svc;
      run(['service'], { target: svc });
      if (!svc.image && !svc.build) ctx.warn(`Service "${v.NAME}" braucht ein Image oder einen Build.`);
    },
  },
  {
    type: 'compose_volume',
    cat: 'compose',
    shape: 'stmt',
    msg: 'Volume %1 Treiber %2 extern %3 echter Name %4',
    args: [T('NAME', 'data'), D('DRIVER', [['Standard', ''], 'local']), C('EXTERNAL', false), T('XNAME', '')],
    scope: ['compose'],
    where: 'unter einen "Docker Compose"-Startblock',
    tip: 'Extern = Volume existiert schon (docker volume create). "echter Name" setzt name: für Volumes aus einem anderen Stack.',
    gen: (v, ctx) => {
      const vols = at(ctx.doc, 'volumes');
      const vol: any = {};
      if (v.DRIVER) vol.driver = v.DRIVER;
      if (v.EXTERNAL) vol.external = true;
      if (v.XNAME) vol.name = v.XNAME;
      vols[v.NAME || 'data'] = Object.keys(vol).length ? vol : null;
    },
  },
  {
    type: 'compose_network',
    cat: 'compose',
    shape: 'stmt',
    msg: 'Netzwerk %1 Treiber %2 extern %3 intern (ohne Internet) %4',
    args: [T('NAME', 'backend'), D('DRIVER', [['Standard', ''], 'bridge', 'overlay', 'host', 'macvlan', 'none']), C('EXTERNAL', false), C('INTERNAL', false)],
    scope: ['compose'],
    where: 'unter einen "Docker Compose"-Startblock',
    gen: (v, ctx) => {
      const nets = at(ctx.doc, 'networks');
      const n: any = {};
      if (v.DRIVER) n.driver = v.DRIVER;
      if (v.EXTERNAL) n.external = true;
      if (v.INTERNAL) n.internal = true;
      nets[v.NAME || 'net'] = Object.keys(n).length ? n : null;
    },
  },
  {
    type: 'compose_secret',
    cat: 'compose',
    shape: 'stmt',
    msg: 'Secret %1 aus %2 %3',
    args: [T('NAME', 'db_password'), D('SRC', [['Datei', 'file'], ['Umgebungsvariable', 'environment'], ['extern', 'external']]), T('FILE', './secrets/db_password.txt')],
    scope: ['compose'],
    where: 'unter einen "Docker Compose"-Startblock',
    gen: (v, ctx) => {
      at(ctx.doc, 'secrets')[v.NAME] = v.SRC === 'external' ? { external: true } : { [v.SRC || 'file']: v.FILE };
    },
  },
  {
    type: 'compose_config', cat: 'compose', shape: 'stmt', msg: 'Config %1 aus %2 %3',
    args: [T('NAME', 'app_config'), D('SRC', [['Datei', 'file'], ['Inhalt', 'content'], ['Umgebungsvariable', 'environment'], ['extern', 'external']]), M('VAL', './config.yml')],
    scope: ['compose'], where: 'unter einen "Docker Compose"-Startblock',
    tip: 'Top-Level configs: – Dateien, die Services mit "nutzt Config" einbinden.',
    gen: (v, ctx) => {
      const cfgs = at(ctx.doc, 'configs');
      cfgs[v.NAME] = v.SRC === 'external' ? { external: true } : { [v.SRC]: v.VAL };
    },
  },
  {
    type: 'compose_include', cat: 'compose', shape: 'stmt', msg: 'Include Datei %1', args: [T('PATH', './other/compose.yaml')], scope: ['compose'], where: 'unter einen "Docker Compose"-Startblock',
    tip: 'Bindet eine weitere Compose-Datei ein (include:).',
    gen: (v, ctx) => { list(ctx.doc, 'include').push(v.PATH); },
  },
  {
    type: 'compose_volume_opt', cat: 'compose', shape: 'stmt', msg: 'Volume %1 Treiber-Option %2 = %3', args: [T('VOL', 'data'), T('K', 'type'), T('V', 'none')], scope: ['compose'], where: 'unter einen "Docker Compose"-Startblock',
    tip: 'driver_opts eines Volumes, z. B. type=none, o=bind, device=/srv/data für Bind-Volumes oder NFS-Optionen.',
    gen: (v, ctx) => {
      const vols = at(ctx.doc, 'volumes');
      if (!vols[v.VOL] || typeof vols[v.VOL] !== 'object') vols[v.VOL] = {};
      at(vols[v.VOL], 'driver_opts')[v.K] = v.V;
    },
  },
  {
    type: 'compose_network_subnet', cat: 'compose', shape: 'stmt', msg: 'Netzwerk %1 Subnetz %2 Gateway %3', args: [T('NET', 'backend'), T('SUBNET', '172.20.0.0/24'), T('GW', '')], scope: ['compose'], where: 'unter einen "Docker Compose"-Startblock',
    gen: (v, ctx) => {
      const nets = at(ctx.doc, 'networks');
      if (!nets[v.NET] || typeof nets[v.NET] !== 'object') nets[v.NET] = {};
      list(at(nets[v.NET], 'ipam'), 'config').push({ subnet: v.SUBNET, gateway: v.GW || undefined });
    },
  },
  {
    type: 'compose_extension', cat: 'compose', shape: 'stmt', msg: 'Erweiterungsfeld x-%1 = %2', args: [T('K', 'common'), M('V', 'restart: unless-stopped')], scope: ['compose'], where: 'unter einen "Docker Compose"-Startblock',
    tip: 'x-Felder (z. B. für Anker). Der Wert ist YAML.',
    gen: (v, ctx) => {
      try { ctx.doc[`x-${v.K}`] = YAML.parse(v.V); } catch (e: any) { ctx.warn('YAML-Fehler: ' + e.message); }
    },
  },
];

// =====================================================================
// COMPOSE SERVICE OPTIONS
// =====================================================================
const S = ['service'];
const SW = 'in einen "Service"-Block';
const service: BlockSpec[] = [
  { type: 'svc_image', cat: 'service', shape: 'stmt', msg: 'Image %1', args: [T('IMAGE', 'nginx:latest')], scope: S, where: SW, gen: (v, c) => { c.target.image = v.IMAGE; } },
  {
    type: 'svc_build', cat: 'service', shape: 'stmt', msg: 'Build Ordner %1 Dockerfile %2', args: [T('CTX', '.'), T('FILE', 'Dockerfile')], scope: S, where: SW,
    gen: (v, c) => {
      c.target.build = v.FILE && v.FILE !== 'Dockerfile' ? { context: v.CTX || '.', dockerfile: v.FILE } : v.CTX || '.';
    },
  },
  {
    type: 'svc_build_arg', cat: 'service', shape: 'stmt', msg: 'Build-Arg %1 = %2', args: [T('K', 'NODE_ENV'), T('V', 'production')], scope: S, where: SW,
    gen: (v, c) => {
      if (typeof c.target.build !== 'object') c.target.build = { context: c.target.build || '.' };
      at(c.target.build, 'args')[v.K] = v.V;
    },
  },
  {
    type: 'svc_port', cat: 'service', shape: 'stmt', msg: 'Port Host %1 → Container %2 %3', args: [T('HOST', '8080'), T('CONT', '80'), D('PROTO', ['tcp', 'udp'])], scope: S, where: SW,
    gen: (v, c) => {
      const p = v.HOST ? `${v.HOST}:${v.CONT}` : String(v.CONT);
      list(c.target, 'ports').push(quoted(v.PROTO === 'udp' ? `${p}/udp` : p));
    },
  },
  { type: 'svc_expose', cat: 'service', shape: 'stmt', msg: 'nur intern freigeben Port %1', args: [T('PORT', '3000')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'expose').push(String(v.PORT)); } },
  { type: 'svc_env', cat: 'service', shape: 'stmt', msg: 'Variable %1 = %2', args: [T('K', 'APP_ENV'), T('V', 'production')], scope: S, where: SW, gen: (v, c) => { at(c.target, 'environment')[v.K] = v.V; } },
  {
    type: 'svc_env_file', cat: 'service', shape: 'stmt', msg: 'Variablen aus Datei %1 Pflicht %2', args: [T('FILE', '.env'), C('REQ', true)], scope: S, where: SW,
    gen: (v, c) => { list(c.target, 'env_file').push(v.REQ ? v.FILE : { path: v.FILE, required: false }); },
  },
  {
    type: 'svc_volume', cat: 'service', shape: 'stmt', msg: 'Volume %1 → %2 nur lesen %3', args: [T('SRC', 'data'), T('DST', '/var/lib/data'), C('RO', false)], scope: S, where: SW,
    gen: (v, c) => { list(c.target, 'volumes').push(`${v.SRC}:${v.DST}${v.RO ? ':ro' : ''}`); },
  },
  {
    type: 'svc_depends', cat: 'service', shape: 'stmt', msg: 'wartet auf %1 bis %2 neu starten mit %3 Pflicht %4',
    args: [T('NAME', 'db'), D('COND', [['gestartet', 'service_started'], ['gesund', 'service_healthy'], ['fertig', 'service_completed_successfully']]), C('RESTART', false), C('REQUIRED', true)],
    scope: S, where: SW,
    tip: '"neu starten mit": Service wird neu gestartet, wenn die Abhängigkeit aktualisiert wird. "Pflicht" aus: Service startet auch ohne sie.',
    gen: (v, c) => { at(c.target, 'depends_on')[v.NAME] = { condition: v.COND, restart: v.RESTART ? true : undefined, required: v.REQUIRED ? undefined : false }; },
  },
  { type: 'svc_restart', cat: 'service', shape: 'stmt', msg: 'Neustart %1', args: [D('R', ['unless-stopped', 'always', 'on-failure', 'no'])], scope: S, where: SW, gen: (v, c) => { c.target.restart = v.R; } },
  { type: 'svc_command', cat: 'service', shape: 'stmt', msg: 'Command %1', args: [M('CMD', 'npm start')], scope: S, where: SW, gen: (v, c) => { c.target.command = splitArgs(v.CMD); } },
  { type: 'svc_entrypoint', cat: 'service', shape: 'stmt', msg: 'Entrypoint %1', args: [T('CMD', '/docker-entrypoint.sh')], scope: S, where: SW, gen: (v, c) => { c.target.entrypoint = splitArgs(v.CMD); } },
  {
    type: 'svc_network', cat: 'service', shape: 'stmt', msg: 'im Netzwerk %1 Aliase %2 feste IP %3', args: [T('NAME', 'backend'), T('ALIASES', ''), T('IP', '')], scope: S, where: SW,
    tip: 'Aliase mit Komma trennen. Sobald Aliase oder eine IP gesetzt sind, wird networks: als Map geschrieben.',
    gen: (v, c) => {
      const cfg: any = {};
      const aliases = v.ALIASES.split(',').map((x: string) => x.trim()).filter(Boolean);
      if (aliases.length) cfg.aliases = aliases;
      if (v.IP) cfg[v.IP.includes(':') ? 'ipv6_address' : 'ipv4_address'] = v.IP;
      const has = Object.keys(cfg).length > 0;
      let nets = c.target.networks;
      if (has && !nets) nets = c.target.networks = {};
      if (has && Array.isArray(nets)) nets = c.target.networks = Object.fromEntries(nets.map((n: string) => [n, null]));
      if (nets && !Array.isArray(nets)) nets[v.NAME] = has ? cfg : null;
      else list(c.target, 'networks').push(v.NAME);
    },
  },
  {
    type: 'svc_healthcheck', cat: 'service', shape: 'stmt', msg: 'Healthcheck %1 %2 alle %3 Timeout %4 Versuche %5 Startphase %6 Start-Intervall %7',
    args: [D('MODE', [['Shell (CMD-SHELL)', 'CMD-SHELL'], ['Befehl (CMD)', 'CMD']]), T('CMD', 'curl -f http://localhost/ || exit 1'), T('INT', '30s'), T('TO', '5s'), T('RET', '3'), T('START', ''), T('SINT', '')],
    scope: S, where: SW,
    tip: 'Shell: Befehl läuft in /bin/sh. Befehl (CMD): direkt ausgeführt, Argumente mit Leerzeichen in Anführungszeichen setzen.',
    gen: (v, c) => {
      const hc: any = { test: v.MODE === 'CMD' ? ['CMD', ...splitArgs(v.CMD)] : ['CMD-SHELL', v.CMD] };
      if (v.INT) hc.interval = v.INT;
      if (v.TO) hc.timeout = v.TO;
      if (v.RET !== '') hc.retries = numOr(v.RET);
      if (v.START) hc.start_period = v.START;
      if (v.SINT) hc.start_interval = v.SINT;
      c.target.healthcheck = hc;
    },
  },
  { type: 'svc_healthcheck_off', cat: 'service', shape: 'stmt', msg: 'Healthcheck ausschalten', args: [], scope: S, where: SW, tip: 'Schaltet einen im Image definierten Healthcheck ab (disable: true).', gen: (_v, c) => { c.target.healthcheck = { disable: true }; } },
  { type: 'svc_label', cat: 'service', shape: 'stmt', msg: 'Label %1 = %2', args: [T('K', 'com.example.team'), T('V', 'platform')], scope: S, where: SW, gen: (v, c) => { at(c.target, 'labels')[v.K] = v.V; } },
  {
    type: 'svc_resources', cat: 'service', shape: 'stmt', msg: '%1 CPU %2 RAM %3', args: [D('KIND', [['Limit', 'limits'], ['Reservierung', 'reservations']]), T('CPU', '0.5'), T('MEM', '512M')], scope: S, where: SW,
    gen: (v, c) => {
      const r = at(c.target, 'deploy', 'resources', v.KIND || 'limits');
      if (v.CPU) r.cpus = v.CPU;
      if (v.MEM) r.memory = v.MEM;
    },
  },
  { type: 'svc_replicas', cat: 'service', shape: 'stmt', msg: 'Replicas %1', args: [N('N', 2, 0, 1)], scope: S, where: SW, gen: (v, c) => { at(c.target, 'deploy').replicas = v.N; } },
  {
    type: 'svc_option', cat: 'service', shape: 'stmt', msg: 'Option %1 = %2',
    args: [D('K', ['container_name', 'hostname', 'user', 'working_dir', 'platform', 'pull_policy', 'stop_signal', 'stop_grace_period', 'shm_size', 'network_mode', 'domainname']), T('V', 'my-app')],
    scope: S, where: SW, gen: (v, c) => { c.target[v.K] = v.V; },
  },
  { type: 'svc_flag', cat: 'service', shape: 'stmt', msg: 'schalte %1 ein', args: [D('K', ['privileged', 'tty', 'stdin_open', 'init', 'read_only'])], scope: S, where: SW, gen: (v, c) => { c.target[v.K] = true; } },
  { type: 'svc_extra_host', cat: 'service', shape: 'stmt', msg: 'Host %1 zeigt auf %2', args: [T('H', 'host.docker.internal'), T('IP', 'host-gateway')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'extra_hosts').push(`${v.H}:${v.IP}`); } },
  {
    type: 'svc_secret', cat: 'service', shape: 'stmt', msg: 'nutzt Secret %1 als %2 Rechte %3', args: [T('NAME', 'db_password'), T('TARGET', ''), T('MODE', '')], scope: S, where: SW,
    tip: 'Ziel und Rechte (z. B. 0440) sind optional. Ohne sie wird die Kurzform geschrieben.',
    gen: (v, c) => {
      if (!v.TARGET && !v.MODE) return void list(c.target, 'secrets').push(v.NAME);
      list(c.target, 'secrets').push({ source: v.NAME, target: v.TARGET || undefined, mode: v.MODE ? octOr(v.MODE) : undefined });
    },
  },
  {
    type: 'svc_logging', cat: 'service', shape: 'stmt', msg: 'Logging %1 max. Größe %2 Dateien %3', args: [D('DRV', ['json-file', 'local', 'syslog', 'journald', 'none']), T('SIZE', '10m'), N('FILES', 3, 1, 1)], scope: S, where: SW,
    gen: (v, c) => { c.target.logging = { driver: v.DRV, options: v.DRV === 'none' ? undefined : { 'max-size': v.SIZE, 'max-file': String(v.FILES) } }; },
  },
  { type: 'svc_profile', cat: 'service', shape: 'stmt', msg: 'nur im Profil %1', args: [T('P', 'debug')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'profiles').push(v.P); } },
  {
    type: 'svc_limits', cat: 'service', shape: 'stmt', msg: 'Grenzen RAM %1 CPUs %2 Prozesse %3', args: [T('MEM', '512m'), T('CPUS', ''), T('PIDS', '')], scope: S, where: SW,
    tip: 'mem_limit, cpus und pids_limit direkt am Service (ohne deploy:). Leere Felder werden weggelassen.',
    gen: (v, c) => {
      if (v.MEM) c.target.mem_limit = v.MEM;
      if (v.CPUS) c.target.cpus = numOr(v.CPUS);
      if (v.PIDS) c.target.pids_limit = numOr(v.PIDS);
    },
  },
  {
    type: 'svc_cap', cat: 'service', shape: 'stmt', msg: 'Capability %1 %2', args: [D('MODE', [['entfernen', 'cap_drop'], ['hinzufügen', 'cap_add']]), T('CAP', 'ALL')], scope: S, where: SW,
    gen: (v, c) => { list(c.target, v.MODE).push(v.CAP); },
  },
  { type: 'svc_security_opt', cat: 'service', shape: 'stmt', msg: 'Security-Option %1', args: [T('OPT', 'no-new-privileges:true')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'security_opt').push(v.OPT); } },
  { type: 'svc_env_pass', cat: 'service', shape: 'stmt', msg: 'Variable %1 vom Host übernehmen', args: [T('K', 'API_KEY')], scope: S, where: SW, tip: 'environment: KEY ohne Wert – Docker übernimmt den Wert aus der Shell/.env.', gen: (v, c) => { at(c.target, 'environment')[v.K] = null; } },
  {
    type: 'svc_tmpfs', cat: 'service', shape: 'stmt', msg: 'tmpfs %1 Größe %2', args: [T('PATH', '/tmp'), T('SIZE', '')], scope: S, where: SW,
    tip: 'RAM-Dateisystem. Ohne Größe: tmpfs:-Liste, mit Größe: volumes-Eintrag vom Typ tmpfs.',
    gen: (v, c) => {
      if (v.SIZE) list(c.target, 'volumes').push({ type: 'tmpfs', target: v.PATH, tmpfs: { size: numOr(v.SIZE) } });
      else list(c.target, 'tmpfs').push(v.PATH);
    },
  },
  {
    type: 'svc_config', cat: 'service', shape: 'stmt', msg: 'nutzt Config %1 als %2 Rechte %3', args: [T('NAME', 'app_config'), T('TARGET', '/etc/app/config.yml'), T('MODE', '')], scope: S, where: SW,
    gen: (v, c) => {
      if (!v.TARGET && !v.MODE) return void list(c.target, 'configs').push(v.NAME);
      list(c.target, 'configs').push({ source: v.NAME, target: v.TARGET || undefined, mode: v.MODE ? octOr(v.MODE) : undefined });
    },
  },
  {
    type: 'svc_ulimit', cat: 'service', shape: 'stmt', msg: 'Ulimit %1 soft %2 hard %3', args: [T('NAME', 'nofile'), T('SOFT', '65536'), T('HARD', '65536')], scope: S, where: SW,
    gen: (v, c) => { at(c.target, 'ulimits')[v.NAME] = v.HARD ? { soft: numOr(v.SOFT), hard: numOr(v.HARD) } : numOr(v.SOFT); },
  },
  { type: 'svc_sysctl', cat: 'service', shape: 'stmt', msg: 'Sysctl %1 = %2', args: [T('K', 'net.core.somaxconn'), T('V', '1024')], scope: S, where: SW, gen: (v, c) => { at(c.target, 'sysctls')[v.K] = numOr(v.V); } },
  { type: 'svc_device', cat: 'service', shape: 'stmt', msg: 'Gerät %1', args: [T('DEV', '/dev/ttyUSB0:/dev/ttyUSB0')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'devices').push(v.DEV); } },
  { type: 'svc_dns', cat: 'service', shape: 'stmt', msg: 'DNS-Server %1', args: [T('IP', '1.1.1.1')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'dns').push(v.IP); } },
  {
    type: 'svc_build_target', cat: 'service', shape: 'stmt', msg: 'Build-Stage %1', args: [T('TARGET', 'production')], scope: S, where: SW, tip: 'Multi-Stage-Builds: baut nur bis zu dieser Stage (build.target). Nach dem Build-Block setzen.',
    gen: (v, c) => {
      if (typeof c.target.build !== 'object') c.target.build = { context: c.target.build || '.' };
      c.target.build.target = v.TARGET;
    },
  },
  {
    type: 'svc_build_cache', cat: 'service', shape: 'stmt', msg: 'Build-Cache von %1', args: [T('FROM', 'type=registry,ref=ghcr.io/example/app:cache')], scope: S, where: SW,
    gen: (v, c) => {
      if (typeof c.target.build !== 'object') c.target.build = { context: c.target.build || '.' };
      list(c.target.build, 'cache_from').push(v.FROM);
    },
  },
  {
    type: 'svc_gpu', cat: 'service', shape: 'stmt', msg: 'GPU Treiber %1 Anzahl %2', args: [T('DRIVER', 'nvidia'), T('COUNT', '1')], scope: S, where: SW, tip: 'GPU-Reservierung (deploy.resources.reservations.devices). Anzahl "all" für alle GPUs.',
    gen: (v, c) => { list(at(c.target, 'deploy', 'resources', 'reservations'), 'devices').push({ driver: v.DRIVER || undefined, count: numOr(v.COUNT), capabilities: ['gpu'] }); },
  },
  {
    type: 'svc_restart_policy', cat: 'service', shape: 'stmt', msg: 'Swarm-Neustart %1 max. Versuche %2 Pause %3', args: [D('COND', ['on-failure', 'any', 'none']), T('MAX', ''), T('DELAY', '')], scope: S, where: SW,
    gen: (v, c) => { at(c.target, 'deploy').restart_policy = { condition: v.COND, delay: v.DELAY || undefined, max_attempts: v.MAX ? numOr(v.MAX) : undefined }; },
  },
  { type: 'svc_restart_max', cat: 'service', shape: 'stmt', msg: 'Neustart bei Fehler, höchstens %1 mal', args: [N('N', 5, 1, 1)], scope: S, where: SW, gen: (v, c) => { c.target.restart = `on-failure:${v.N}`; } },
  {
    type: 'svc_extends', cat: 'service', shape: 'stmt', msg: 'erweitert Service %1 aus Datei %2', args: [T('SVC', 'base'), T('FILE', '')], scope: S, where: SW, tip: 'Übernimmt die Einstellungen eines anderen Services (extends:). Datei leer = gleiche Datei.',
    gen: (v, c) => { c.target.extends = { file: v.FILE || undefined, service: v.SVC }; },
  },
  {
    type: 'svc_watch', cat: 'service', shape: 'stmt', msg: 'Watch %1 Ordner %2 → %3', args: [D('ACTION', ['sync', 'rebuild', 'sync+restart', 'sync+exec', 'restart']), T('PATH', './src'), T('TARGET', '/app/src')], scope: S, where: SW, tip: 'docker compose watch (develop.watch).',
    gen: (v, c) => { list(at(c.target, 'develop'), 'watch').push({ action: v.ACTION, path: v.PATH, target: v.TARGET || undefined }); },
  },
];

// =====================================================================
// KUBERNETES / OPENSHIFT RESOURCES (hats)
// =====================================================================
const resources: BlockSpec[] = [
  {
    type: 'k8s_namespace', cat: 'resources', shape: 'hat', msg: 'Namespace %1', args: [T('NAME', 'demo-project')],
    gen: (v, ctx, run) => { const doc = newDoc(ctx, 'v1', 'Namespace', v.NAME); run(['k8s', 'Namespace'], { doc, target: doc }); },
  },
  {
    type: 'k8s_deployment', cat: 'resources', shape: 'hat', msg: 'Deployment %1 Replicas %2', args: [T('NAME', 'demo-app'), N('REPLICAS', 2, 0, 1)],
    tip: 'Startet Pods. Lege Container (orange) und Metadaten darunter.',
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      const doc = newDoc(ctx, 'apps/v1', 'Deployment', v.NAME, { replicas: v.REPLICAS, strategy: undefined, selector: { matchLabels: { app: v.NAME } }, template: tpl });
      run(['k8s', 'Deployment', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_deploymentconfig', cat: 'resources', shape: 'hat', msg: 'DeploymentConfig (OpenShift) %1 Replicas %2', args: [T('NAME', 'demo-app'), N('REPLICAS', 1, 0, 1)],
    tip: 'Klassische OpenShift-DeploymentConfig. Strategie und Trigger über die DC-Blöcke (Pod-Kategorie).',
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      const doc = newDoc(ctx, 'apps.openshift.io/v1', 'DeploymentConfig', v.NAME, { replicas: v.REPLICAS, selector: { app: v.NAME }, strategy: undefined, triggers: [], template: tpl });
      run(['k8s', 'DeploymentConfig', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_statefulset', cat: 'resources', shape: 'hat', msg: 'StatefulSet %1 Replicas %2 Service %3', args: [T('NAME', 'postgres'), N('REPLICAS', 1, 0, 1), T('SVC', 'postgres')],
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      const doc = newDoc(ctx, 'apps/v1', 'StatefulSet', v.NAME, { serviceName: v.SVC, replicas: v.REPLICAS, selector: { matchLabels: { app: v.NAME } }, template: tpl });
      run(['k8s', 'StatefulSet', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_daemonset', cat: 'resources', shape: 'hat', msg: 'DaemonSet %1', args: [T('NAME', 'node-agent')],
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      const doc = newDoc(ctx, 'apps/v1', 'DaemonSet', v.NAME, { selector: { matchLabels: { app: v.NAME } }, template: tpl });
      run(['k8s', 'DaemonSet', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_job', cat: 'resources', shape: 'hat', msg: 'Job %1 Versuche %2', args: [T('NAME', 'db-migrate'), N('BACKOFF', 3, 0, 1)],
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      (tpl.spec as any).restartPolicy = 'Never';
      const doc = newDoc(ctx, 'batch/v1', 'Job', v.NAME, { backoffLimit: v.BACKOFF, template: tpl });
      run(['k8s', 'Job', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_cronjob', cat: 'resources', shape: 'hat', msg: 'CronJob %1 Zeitplan %2', args: [T('NAME', 'nightly-backup'), T('SCHEDULE', '0 2 * * *')],
    gen: (v, ctx, run) => {
      const tpl = podTemplate(v.NAME);
      (tpl.spec as any).restartPolicy = 'OnFailure';
      const doc = newDoc(ctx, 'batch/v1', 'CronJob', v.NAME, { schedule: v.SCHEDULE, jobTemplate: { spec: { template: tpl } } });
      run(['k8s', 'CronJob', 'pod'], { doc, target: doc, pod: tpl.spec, podMeta: tpl.metadata });
      checkContainers(ctx, tpl.spec, v.NAME);
    },
  },
  {
    type: 'k8s_service', cat: 'resources', shape: 'hat', msg: 'Service %1 für App %2 Typ %3',
    args: [T('NAME', 'demo-app'), T('APP', 'demo-app'), D('TYPE', ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'])],
    gen: (v, ctx, run) => {
      const spec: any = { selector: v.APP ? { app: v.APP } : undefined, ports: [], type: v.TYPE };
      const doc = newDoc(ctx, 'v1', 'Service', v.NAME, spec);
      run(['k8s', 'Service'], { doc, target: doc });
      if (!spec.ports.length && spec.type !== 'ExternalName') ctx.warn(`Service "${v.NAME}" hat noch keinen Port-Block.`);
    },
  },
  {
    type: 'k8s_route', cat: 'resources', shape: 'hat', msg: 'Route %1 → Service %2 Port %3',
    args: [T('NAME', 'demo-app'), T('SVC', 'demo-app'), T('PORT', 'http')], tip: 'OpenShift Route: macht einen Service von außen erreichbar.',
    gen: (v, ctx, run) => {
      const spec: any = { host: undefined, path: undefined, to: { kind: 'Service', name: v.SVC }, port: v.PORT ? { targetPort: portVal(v.PORT) } : undefined, tls: undefined };
      const doc = newDoc(ctx, 'route.openshift.io/v1', 'Route', v.NAME, spec);
      run(['k8s', 'Route'], { doc, target: doc });
    },
  },
  {
    type: 'k8s_ingress', cat: 'resources', shape: 'hat', msg: 'Ingress %1 Klasse %2', args: [T('NAME', 'demo-app'), T('CLASS', 'nginx')],
    gen: (v, ctx, run) => {
      const spec: any = { ingressClassName: v.CLASS || undefined, tls: [], rules: [] };
      const doc = newDoc(ctx, 'networking.k8s.io/v1', 'Ingress', v.NAME, spec);
      run(['k8s', 'Ingress'], { doc, target: doc });
      if (!spec.rules.length) ctx.warn(`Ingress "${v.NAME}" hat noch keine Regel.`);
    },
  },
  {
    type: 'k8s_configmap', cat: 'resources', shape: 'hat', msg: 'ConfigMap %1', args: [T('NAME', 'demo-app-config')],
    gen: (v, ctx, run) => {
      const doc = newDoc(ctx, 'v1', 'ConfigMap', v.NAME);
      doc.data = {};
      run(['k8s', 'ConfigMap'], { doc, target: doc });
    },
  },
  {
    type: 'k8s_secret', cat: 'resources', shape: 'hat', msg: 'Secret %1 Typ %2',
    args: [T('NAME', 'demo-app-secret'), D('TYPE', ['Opaque', 'kubernetes.io/dockerconfigjson', 'kubernetes.io/tls', 'kubernetes.io/basic-auth', 'kubernetes.io/ssh-auth'])],
    tip: 'Achtung: Base64 ist keine Verschlüsselung. Keine echten Passwörter in Git committen!',
    gen: (v, ctx, run) => {
      const doc = newDoc(ctx, 'v1', 'Secret', v.NAME);
      doc.type = v.TYPE;
      doc.stringData = {};
      doc.data = {};
      run(['k8s', 'Secret'], { doc, target: doc });
    },
  },
  {
    type: 'k8s_pvc', cat: 'resources', shape: 'hat', msg: 'Speicher (PVC) %1 Größe %2 Zugriff %3',
    args: [T('NAME', 'demo-app-data'), T('SIZE', '5Gi'), D('MODE', ['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany', 'ReadWriteOncePod'])],
    gen: (v, ctx, run) => {
      const doc = newDoc(ctx, 'v1', 'PersistentVolumeClaim', v.NAME, { accessModes: [v.MODE], storageClassName: undefined, volumeMode: undefined, resources: { requests: { storage: v.SIZE } } });
      run(['k8s', 'PersistentVolumeClaim'], { doc, target: doc });
    },
  },
  {
    type: 'k8s_hpa', cat: 'resources', shape: 'hat', msg: 'Autoscaler %1 für Deployment %2 min %3 max %4',
    args: [T('NAME', 'demo-app-hpa'), T('TARGET', 'demo-app'), N('MIN', 2, 1, 1), N('MAX', 5, 1, 1)],
    gen: (v, ctx, run) => {
      const spec: any = { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: v.TARGET }, minReplicas: v.MIN, maxReplicas: v.MAX, metrics: [] };
      const doc = newDoc(ctx, 'autoscaling/v2', 'HorizontalPodAutoscaler', v.NAME, spec);
      run(['k8s', 'HorizontalPodAutoscaler'], { doc, target: doc });
      if (v.MIN > v.MAX) ctx.warn('min ist größer als max.');
      if (!spec.metrics.length) ctx.warn(`Autoscaler "${v.NAME}" hat noch keine Metrik.`);
    },
  },
  {
    type: 'k8s_imagestream', cat: 'resources', shape: 'hat', msg: 'ImageStream %1 lokaler Lookup %2', args: [T('NAME', 'demo-app'), C('LOCAL', false)],
    tip: 'OpenShift ImageStream: Ziel für BuildConfig-Images.',
    gen: (v, ctx, run) => {
      const doc = newDoc(ctx, 'image.openshift.io/v1', 'ImageStream', v.NAME, { lookupPolicy: { local: !!v.LOCAL }, tags: [] });
      run(['k8s', 'ImageStream'], { doc, target: doc });
    },
  },
  {
    type: 'k8s_buildconfig', cat: 'resources', shape: 'hat', msg: 'BuildConfig %1 → ImageStreamTag %2 Ablauf %3',
    args: [T('NAME', 'demo-app-build'), T('OUT', 'demo-app:latest'), D('RUN', ['Serial', 'Parallel', 'SerialLatestOnly'])],
    tip: 'OpenShift BuildConfig: baut ein Image aus Git und schiebt es in einen ImageStream. Für externe Registries das Ziel leer lassen und "Image schieben nach" nutzen.',
    gen: (v, ctx, run) => {
      const spec: any = { runPolicy: v.RUN, source: undefined, strategy: undefined, output: v.OUT ? { to: { kind: 'ImageStreamTag', name: v.OUT } } : undefined, triggers: [] };
      const doc = newDoc(ctx, 'build.openshift.io/v1', 'BuildConfig', v.NAME, spec);
      run(['k8s', 'BuildConfig'], { doc, target: doc });
      if (!spec.source) ctx.warn('BuildConfig braucht eine Quelle (z.B. Git).');
      if (!spec.strategy) ctx.warn('BuildConfig braucht eine Strategie (Docker oder S2I).');
      if (!spec.output) ctx.warn('BuildConfig ohne Ziel: ImageStreamTag im Startblock oder "Image schieben nach"-Block setzen.');
    },
  },
  {
    type: 'k8s_serviceaccount', cat: 'resources', shape: 'hat', msg: 'ServiceAccount %1', args: [T('NAME', 'demo-app')],
    gen: (v, ctx, run) => { const doc = newDoc(ctx, 'v1', 'ServiceAccount', v.NAME); run(['k8s', 'ServiceAccount'], { doc, target: doc }); },
  },
  {
    type: 'k8s_custom', cat: 'resources', shape: 'hat', msg: 'Eigene Ressource %1 kind %2 apiVersion %3',
    args: [T('NAME', 'my-resource'), T('KIND', 'Certificate'), T('API', 'cert-manager.io/v1')],
    tip: 'Für jede andere Ressource. Nutze die Extras-Blöcke für den Inhalt.',
    gen: (v, ctx, run) => { const doc = newDoc(ctx, v.API, v.KIND, v.NAME); run(['k8s', v.KIND], { doc, target: doc }); },
  },
  {
    type: 'k8s_template', cat: 'resources', shape: 'hat', msg: 'OpenShift Template %1 Beschreibung %2', args: [T('NAME', 'my-template'), T('DESC', '')],
    tip: 'Alle anderen Startblöcke dieser Datei werden zu den objects: des Templates. Parameter mit ${NAME} oder ${{NAME}} (Zahlen) verwenden.',
    gen: (v, ctx, run) => {
      const doc: any = { apiVersion: 'template.openshift.io/v1', kind: 'Template', metadata: { name: v.NAME || 'template' }, parameters: [], objects: [], __template: true };
      if (v.DESC) at(doc.metadata, 'annotations').description = v.DESC;
      ctx.out.push(doc);
      run(['k8s', 'Template'], { doc, target: doc });
    },
  },
];

// =====================================================================
// METADATA
// =====================================================================
const MW = 'unter einen Ressourcen-Startblock (gelb)';
const metadata: BlockSpec[] = [
  { type: 'meta_namespace', cat: 'metadata', shape: 'stmt', msg: 'im Namespace %1', args: [T('NS', 'demo-project')], scope: ['k8s'], where: MW, gen: (v, c) => { c.doc.metadata.namespace = v.NS; } },
  { type: 'meta_label', cat: 'metadata', shape: 'stmt', msg: 'Label %1 = %2', args: [T('K', 'app.kubernetes.io/part-of'), T('V', 'demo')], scope: ['k8s'], where: MW, gen: (v, c) => { at(c.doc.metadata, 'labels')[v.K] = v.V; } },
  { type: 'meta_annotation', cat: 'metadata', shape: 'stmt', msg: 'Annotation %1 = %2', args: [T('K', 'description'), T('V', 'Meine App')], scope: ['k8s'], where: MW, gen: (v, c) => { at(c.doc.metadata, 'annotations')[v.K] = v.V; } },
  {
    type: 'meta_image_trigger', cat: 'metadata', shape: 'stmt', msg: 'neues Image aus %1 → Container %2 aktualisieren',
    args: [T('IST', 'demo-app:latest'), T('CONT', 'demo-app')], scope: POD_KINDS, where: 'unter ein Deployment / StatefulSet',
    tip: 'OpenShift Image-Trigger: aktualisiert den Container, sobald der ImageStreamTag ein neues Image bekommt.',
    gen: (v, c) => {
      const ann = at(c.doc.metadata, 'annotations');
      const key = 'image.openshift.io/triggers';
      let arr: any[] = [];
      try { arr = ann[key] ? JSON.parse(ann[key]) : []; } catch { arr = []; }
      arr.push({ from: { kind: 'ImageStreamTag', name: v.IST }, fieldPath: `spec.template.spec.containers[?(@.name=="${v.CONT}")].image` });
      ann[key] = JSON.stringify(arr);
    },
  },
];

// =====================================================================
// POD
// =====================================================================
const P = ['pod'];
const PW = 'unter ein Deployment, StatefulSet, Job oder CronJob';
const pod: BlockSpec[] = [
  {
    type: 'pod_container', cat: 'pod', shape: 'c', msg: 'Container %1 Image %2', args: [T('NAME', 'demo-app'), T('IMAGE', 'nginx:latest')], scope: P, where: PW,
    tip: 'Ein Container im Pod. Lege Container-Blöcke (hellblau) hinein.',
    gen: (v, c, run) => {
      const cont: any = { name: v.NAME, image: v.IMAGE || undefined };
      list(c.pod, 'containers').push(cont);
      run(['container'], { target: cont, container: cont });
      if (!cont.image) c.warn(`Container "${v.NAME}" braucht ein Image.`);
    },
  },
  {
    type: 'pod_init_container', cat: 'pod', shape: 'c', msg: 'Init-Container %1 Image %2', args: [T('NAME', 'wait-for-db'), T('IMAGE', 'busybox:1.36')], scope: P, where: PW,
    gen: (v, c, run) => {
      const cont: any = { name: v.NAME, image: v.IMAGE || undefined };
      list(c.pod, 'initContainers').push(cont);
      run(['container'], { target: cont, container: cont });
    },
  },
  {
    type: 'pod_label', cat: 'pod', shape: 'stmt', msg: 'Pod-Label %1 = %2', args: [T('K', 'version'), T('V', 'v1')], scope: P, where: PW,
    gen: (v, c) => { at(c.podMeta, 'labels')[v.K] = v.V; },
  },
  { type: 'pod_annotation', cat: 'pod', shape: 'stmt', msg: 'Pod-Annotation %1 = %2', args: [T('K', 'prometheus.io/scrape'), T('V', 'true')], scope: P, where: PW, gen: (v, c) => { at(c.podMeta, 'annotations')[v.K] = v.V; } },
  { type: 'pod_pull_secret', cat: 'pod', shape: 'stmt', msg: 'Image Pull Secret %1', args: [T('NAME', 'registry-credentials')], scope: P, where: PW, gen: (v, c) => { list(c.pod, 'imagePullSecrets').push({ name: v.NAME }); } },
  { type: 'pod_service_account', cat: 'pod', shape: 'stmt', msg: 'läuft als ServiceAccount %1', args: [T('NAME', 'demo-app')], scope: P, where: PW, gen: (v, c) => { c.pod.serviceAccountName = v.NAME; } },
  { type: 'pod_vol_pvc', cat: 'pod', shape: 'stmt', msg: 'Volume %1 aus PVC %2', args: [T('NAME', 'data'), T('CLAIM', 'demo-app-data')], scope: P, where: PW, gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, persistentVolumeClaim: { claimName: v.CLAIM } }); } },
  {
    type: 'pod_vol_cm', cat: 'pod', shape: 'stmt', msg: 'Volume %1 aus ConfigMap %2 Rechte %3 nur Schlüssel %4', args: [T('NAME', 'config'), T('CM', 'demo-app-config'), T('MODE', ''), T('ITEMS', '')], scope: P, where: PW,
    tip: 'Rechte z. B. 0644. "nur Schlüssel": key=pfad, mit Komma getrennt (leer = alle Schlüssel).',
    gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, configMap: { name: v.CM, defaultMode: v.MODE ? octOr(v.MODE) : undefined, items: itemsOf(v.ITEMS) } }); },
  },
  {
    type: 'pod_vol_secret', cat: 'pod', shape: 'stmt', msg: 'Volume %1 aus Secret %2 Rechte %3 nur Schlüssel %4', args: [T('NAME', 'certs'), T('SECRET', 'demo-app-tls'), T('MODE', ''), T('ITEMS', '')], scope: P, where: PW,
    gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, secret: { secretName: v.SECRET, defaultMode: v.MODE ? octOr(v.MODE) : undefined, items: itemsOf(v.ITEMS) } }); },
  },
  { type: 'pod_vol_empty', cat: 'pod', shape: 'stmt', msg: 'leeres Volume %1 im RAM %2', args: [T('NAME', 'tmp'), C('MEM', false)], scope: P, where: PW, gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, emptyDir: v.MEM ? { medium: 'Memory' } : {} }); } },
  { type: 'pod_node_selector', cat: 'pod', shape: 'stmt', msg: 'nur auf Nodes mit %1 = %2', args: [T('K', 'node-role.kubernetes.io/worker'), T('V', '')], scope: P, where: PW, gen: (v, c) => { at(c.pod, 'nodeSelector')[v.K] = v.V; } },
  { type: 'pod_restart_policy', cat: 'pod', shape: 'stmt', msg: 'Neustart-Regel %1', args: [D('R', ['Always', 'OnFailure', 'Never'])], scope: P, where: PW, gen: (v, c) => { c.pod.restartPolicy = v.R; } },
  {
    type: 'pod_strategy', cat: 'pod', shape: 'stmt', msg: 'Update-Strategie %1', args: [D('S', ['RollingUpdate', 'Recreate'])], scope: ['Deployment'], where: 'unter ein Deployment',
    gen: (v, c) => { c.doc.spec.strategy = { type: v.S }; },
  },
  {
    type: 'dc_strategy', cat: 'pod', shape: 'stmt', msg: 'DC-Strategie %1 Intervall %2 s Update-Pause %3 s Timeout %4 s max. weg %5 max. extra %6',
    args: [D('S', ['Rolling', 'Recreate']), T('INTERVAL', ''), T('UPDATE', ''), T('TIMEOUT', '600'), T('UNAVAIL', '25%'), T('SURGE', '25%')],
    scope: ['DeploymentConfig'], where: 'unter eine DeploymentConfig',
    gen: (v, c) => {
      const params: any = {};
      if (v.S === 'Rolling') {
        if (v.UPDATE) params.updatePeriodSeconds = numOr(v.UPDATE);
        if (v.INTERVAL) params.intervalSeconds = numOr(v.INTERVAL);
        if (v.TIMEOUT) params.timeoutSeconds = numOr(v.TIMEOUT);
        if (v.UNAVAIL) params.maxUnavailable = numOr(v.UNAVAIL);
        if (v.SURGE) params.maxSurge = numOr(v.SURGE);
      } else if (v.TIMEOUT) params.timeoutSeconds = numOr(v.TIMEOUT);
      c.doc.spec.strategy = { type: v.S, [v.S === 'Rolling' ? 'rollingParams' : 'recreateParams']: Object.keys(params).length ? params : undefined };
    },
  },
  {
    type: 'dc_trigger', cat: 'pod', shape: 'stmt', msg: 'DC-Trigger %1 ImageStreamTag %2 Container %3',
    args: [D('T', [['Config-Änderung', 'ConfigChange'], ['neues Image', 'ImageChange']]), T('IST', ''), T('CONT', '')],
    scope: ['DeploymentConfig'], where: 'unter eine DeploymentConfig',
    gen: (v, c) => {
      if (v.T === 'ConfigChange') return void c.doc.spec.triggers.push({ type: 'ConfigChange' });
      c.doc.spec.triggers.push({ type: 'ImageChange', imageChangeParams: { automatic: true, containerNames: v.CONT ? [v.CONT] : undefined, from: { kind: 'ImageStreamTag', name: v.IST } } });
    },
  },
  {
    type: 'pod_security', cat: 'pod', shape: 'stmt', msg: 'Pod läuft nicht als root %1 fsGroup %2 User %3 Gruppe %4', args: [C('NONROOT', true), T('FSGROUP', ''), T('USER', ''), T('GROUP', '')], scope: P, where: PW,
    gen: (v, c) => {
      const sc = at(c.pod, 'securityContext');
      sc.runAsNonRoot = !!v.NONROOT;
      if (v.USER) sc.runAsUser = numOr(v.USER);
      if (v.GROUP) sc.runAsGroup = numOr(v.GROUP);
      if (v.FSGROUP) sc.fsGroup = Number(v.FSGROUP) || v.FSGROUP;
    },
  },
  { type: 'pod_grace', cat: 'pod', shape: 'stmt', msg: 'Beenden-Wartezeit %1 Sekunden', args: [N('S', 30, 0, 1)], scope: P, where: PW, gen: (v, c) => { c.pod.terminationGracePeriodSeconds = v.S; } },
  {
    type: 'pod_vol_host', cat: 'pod', shape: 'stmt', msg: 'Volume %1 vom Host-Pfad %2 Typ %3', args: [T('NAME', 'host-logs'), T('PATH', '/var/log'), D('TYPE', [['beliebig', ''], 'Directory', 'DirectoryOrCreate', 'File', 'FileOrCreate', 'Socket', 'CharDevice', 'BlockDevice'])], scope: P, where: PW,
    tip: 'hostPath – auf OpenShift meist nur mit privilegierter SCC erlaubt.',
    gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, hostPath: { path: v.PATH, type: v.TYPE || undefined } }); },
  },
  {
    type: 'pod_toleration', cat: 'pod', shape: 'stmt', msg: 'toleriert Taint %1 %2 %3 Effekt %4', args: [T('KEY', 'dedicated'), D('OP', [['=', 'Equal'], ['existiert', 'Exists']]), T('VAL', 'app'), D('EFFECT', [['alle', ''], 'NoSchedule', 'PreferNoSchedule', 'NoExecute'])], scope: P, where: PW,
    gen: (v, c) => { list(c.pod, 'tolerations').push({ key: v.KEY || undefined, operator: v.OP, value: v.OP === 'Equal' && v.VAL ? v.VAL : undefined, effect: v.EFFECT || undefined }); },
  },
];

// =====================================================================
// CONTAINER
// =====================================================================
const K = ['container'];
const KW = 'in einen "Container"-Block';
const container: BlockSpec[] = [
  { type: 'c_image', cat: 'container', shape: 'stmt', msg: 'Image %1', args: [T('IMAGE', 'image-registry.openshift-image-registry.svc:5000/demo-project/demo-app:latest')], scope: K, where: KW, gen: (v, c) => { c.container.image = v.IMAGE; } },
  {
    type: 'c_port', cat: 'container', shape: 'stmt', msg: 'Port %1 Name %2 %3', args: [N('PORT', 8080, 1, 1), T('NAME', ''), D('PROTO', ['TCP', 'UDP', 'SCTP'])], scope: K, where: KW,
    gen: (v, c) => {
      const p: any = { name: v.NAME || undefined, containerPort: v.PORT };
      if (v.PROTO !== 'TCP') p.protocol = v.PROTO;
      list(c.container, 'ports').push(p);
    },
  },
  { type: 'c_env', cat: 'container', shape: 'stmt', msg: 'Variable %1 = %2', args: [T('K', 'LOG_LEVEL'), T('V', 'info')], scope: K, where: KW, gen: (v, c) => { list(c.container, 'env').push({ name: v.K, value: v.V }); } },
  {
    type: 'c_env_ref', cat: 'container', shape: 'stmt', msg: 'Variable %1 aus %2 %3 Schlüssel %4 optional %5',
    args: [T('K', 'DB_PASSWORD'), D('SRC', [['Secret', 'secretKeyRef'], ['ConfigMap', 'configMapKeyRef']]), T('NAME', 'demo-app-secret'), T('KEY', 'DB_PASSWORD'), C('OPT', false)], scope: K, where: KW,
    gen: (v, c) => { list(c.container, 'env').push({ name: v.K, valueFrom: { [v.SRC]: { name: v.NAME, key: v.KEY, optional: v.OPT ? true : undefined } } }); },
  },
  {
    type: 'c_env_from', cat: 'container', shape: 'stmt', msg: 'alle Variablen aus %1 %2 Präfix %3 optional %4', args: [D('SRC', [['ConfigMap', 'configMapRef'], ['Secret', 'secretRef']]), T('NAME', 'demo-app-config'), T('PREFIX', ''), C('OPT', false)], scope: K, where: KW,
    gen: (v, c) => { list(c.container, 'envFrom').push({ prefix: v.PREFIX || undefined, [v.SRC]: { name: v.NAME, optional: v.OPT ? true : undefined } }); },
  },
  {
    type: 'c_resources', cat: 'container', shape: 'stmt', msg: '%1 CPU %2 RAM %3', args: [D('KIND', [['mindestens (requests)', 'requests'], ['höchstens (limits)', 'limits']]), T('CPU', '100m'), T('MEM', '128Mi')], scope: K, where: KW,
    gen: (v, c) => {
      const r = at(c.container, 'resources', v.KIND);
      if (v.CPU) r.cpu = v.CPU;
      if (v.MEM) r.memory = v.MEM;
    },
  },
  {
    type: 'c_mount', cat: 'container', shape: 'stmt', msg: 'Volume %1 einhängen in %2 nur lesen %3 Unterpfad %4', args: [T('NAME', 'data'), T('PATH', '/data'), C('RO', false), T('SUB', '')], scope: K, where: KW,
    tip: 'Unterpfad (subPath): nur eine Datei/einen Ordner aus dem Volume einhängen, z. B. nginx.conf aus einer ConfigMap.',
    gen: (v, c) => { list(c.container, 'volumeMounts').push({ name: v.NAME, mountPath: v.PATH, subPath: v.SUB || undefined, readOnly: v.RO ? true : undefined }); },
  },
  { type: 'c_command', cat: 'container', shape: 'stmt', msg: 'Command %1', args: [M('CMD', '/bin/sh -c "echo hallo"')], scope: K, where: KW, gen: (v, c) => { c.container.command = splitArgs(v.CMD); } },
  { type: 'c_args', cat: 'container', shape: 'stmt', msg: 'Argumente %1', args: [M('ARGS', '--port 8080')], scope: K, where: KW, gen: (v, c) => { c.container.args = splitArgs(v.ARGS); } },
  { type: 'c_pull', cat: 'container', shape: 'stmt', msg: 'Image laden %1', args: [D('P', ['IfNotPresent', 'Always', 'Never'])], scope: K, where: KW, gen: (v, c) => { c.container.imagePullPolicy = v.P; } },
  { type: 'c_workdir', cat: 'container', shape: 'stmt', msg: 'Arbeitsordner %1', args: [T('DIR', '/app')], scope: K, where: KW, gen: (v, c) => { c.container.workingDir = v.DIR; } },
  {
    type: 'c_probe', cat: 'container', shape: 'stmt', msg: '%1 prüfen per %2 Pfad %3 Port %4 nach %5 s alle %6 s Timeout %7 s Fehlversuche %8',
    args: [D('KIND', [['Lebt? (liveness)', 'livenessProbe'], ['Bereit? (readiness)', 'readinessProbe'], ['Gestartet? (startup)', 'startupProbe']]), D('HOW', [['HTTP GET', 'http'], ['HTTPS GET', 'https'], ['TCP', 'tcp']]), T('PATH', '/healthz'), T('PORT', '8080'), N('DELAY', 5, 0, 1), N('PERIOD', 10, 1, 1), T('TIMEOUT', ''), T('FAIL', '')],
    scope: K, where: KW,
    gen: (v, c) => {
      const probe: any = v.HOW === 'tcp' ? { tcpSocket: { port: portVal(v.PORT) } } : { httpGet: { path: v.PATH || '/', port: portVal(v.PORT), scheme: v.HOW === 'https' ? 'HTTPS' : undefined } };
      probe.initialDelaySeconds = v.DELAY;
      probe.periodSeconds = v.PERIOD;
      if (v.TIMEOUT) probe.timeoutSeconds = numOr(v.TIMEOUT);
      if (v.FAIL) probe.failureThreshold = numOr(v.FAIL);
      c.container[v.KIND] = probe;
    },
  },
  {
    type: 'c_security', cat: 'container', shape: 'stmt', msg: 'sicher: keine Rechte-Ausweitung %1 Root-FS nur lesen %2 alle Capabilities weg %3', args: [C('NOESC', true), C('ROFS', false), C('DROP', true)], scope: K, where: KW,
    gen: (v, c) => {
      const sc = at(c.container, 'securityContext');
      sc.allowPrivilegeEscalation = !v.NOESC;
      if (v.ROFS) sc.readOnlyRootFilesystem = true;
      if (v.DROP) sc.capabilities = { drop: ['ALL'] };
    },
  },
  {
    type: 'c_probe_exec', cat: 'container', shape: 'stmt', msg: '%1 prüfen per Befehl %2 nach %3 s alle %4 s Timeout %5 s Fehlversuche %6',
    args: [D('KIND', [['Lebt? (liveness)', 'livenessProbe'], ['Bereit? (readiness)', 'readinessProbe'], ['Gestartet? (startup)', 'startupProbe']]), T('CMD', 'cat /tmp/healthy'), T('DELAY', ''), T('PERIOD', ''), T('TIMEOUT', ''), T('FAIL', '')],
    scope: K, where: KW,
    gen: (v, c) => {
      const probe: any = { exec: { command: splitArgs(v.CMD) } };
      if (v.DELAY) probe.initialDelaySeconds = numOr(v.DELAY);
      if (v.PERIOD) probe.periodSeconds = numOr(v.PERIOD);
      if (v.TIMEOUT) probe.timeoutSeconds = numOr(v.TIMEOUT);
      if (v.FAIL) probe.failureThreshold = numOr(v.FAIL);
      c.container[v.KIND] = probe;
    },
  },
  {
    type: 'c_env_field', cat: 'container', shape: 'stmt', msg: 'Variable %1 aus Pod-Feld %2',
    args: [T('K', 'POD_NAME'), D('PATH', ['metadata.name', 'metadata.namespace', 'metadata.uid', 'spec.nodeName', 'spec.serviceAccountName', 'status.podIP', 'status.hostIP', "metadata.labels['app']"])],
    scope: K, where: KW, tip: 'Downward API (fieldRef): Infos über den eigenen Pod als Umgebungsvariable.',
    gen: (v, c) => { list(c.container, 'env').push({ name: v.K, valueFrom: { fieldRef: { fieldPath: v.PATH } } }); },
  },
  {
    type: 'c_env_resource', cat: 'container', shape: 'stmt', msg: 'Variable %1 aus Ressource %2 Container %3',
    args: [T('K', 'MEM_LIMIT'), D('RES', ['limits.memory', 'limits.cpu', 'requests.memory', 'requests.cpu', 'limits.ephemeral-storage', 'requests.ephemeral-storage']), T('CONT', '')],
    scope: K, where: KW, tip: 'Downward API (resourceFieldRef): eigene Requests/Limits als Variable.',
    gen: (v, c) => { list(c.container, 'env').push({ name: v.K, valueFrom: { resourceFieldRef: { containerName: v.CONT || undefined, resource: v.RES } } }); },
  },
  {
    type: 'c_lifecycle', cat: 'container', shape: 'stmt', msg: '%1 führe aus %2', args: [D('HOOK', [['vor dem Stoppen (preStop)', 'preStop'], ['nach dem Start (postStart)', 'postStart']]), T('CMD', 'sh -c "sleep 5"')], scope: K, where: KW,
    gen: (v, c) => { at(c.container, 'lifecycle')[v.HOOK] = { exec: { command: splitArgs(v.CMD) } }; },
  },
  {
    type: 'c_run_as', cat: 'container', shape: 'stmt', msg: 'läuft als User %1 Gruppe %2', args: [T('USER', '1001'), T('GROUP', '')], scope: K, where: KW,
    gen: (v, c) => {
      const sc = at(c.container, 'securityContext');
      if (v.USER) sc.runAsUser = numOr(v.USER);
      if (v.GROUP) sc.runAsGroup = numOr(v.GROUP);
    },
  },
];

// =====================================================================
// NETWORK (Service / Route / Ingress)
// =====================================================================
const network: BlockSpec[] = [
  {
    type: 'svc_k8s_port', cat: 'network', shape: 'stmt', msg: 'Port %1 → Ziel %2 Name %3 %4', args: [N('PORT', 80, 1, 1), T('TARGET', '8080'), T('NAME', 'http'), D('PROTO', ['TCP', 'UDP'])], scope: ['Service'], where: 'unter einen Service (gelb)',
    gen: (v, c) => {
      const p: any = { name: v.NAME || undefined, port: v.PORT, targetPort: v.TARGET ? portVal(v.TARGET) : undefined };
      if (v.PROTO !== 'TCP') p.protocol = v.PROTO;
      list(c.doc.spec, 'ports').push(p);
    },
  },
  { type: 'svc_k8s_nodeport', cat: 'network', shape: 'stmt', msg: 'NodePort %1 für Port %2', args: [N('NP', 30080, 30000, 1), N('PORT', 80, 1, 1)], scope: ['Service'], where: 'unter einen Service', gen: (v, c) => { const p = (c.doc.spec.ports || []).find((x: any) => x.port === v.PORT); if (p) p.nodePort = v.NP; else c.warn(`Kein Port ${v.PORT} über diesem Block.`); } },
  { type: 'svc_k8s_selector', cat: 'network', shape: 'stmt', msg: 'wählt Pods mit %1 = %2', args: [T('K', 'tier'), T('V', 'frontend')], scope: ['Service'], where: 'unter einen Service', gen: (v, c) => { at(c.doc.spec, 'selector')[v.K] = v.V; } },
  { type: 'route_host', cat: 'network', shape: 'stmt', msg: 'Hostname %1', args: [T('HOST', 'demo.apps.example.com')], scope: ['Route'], where: 'unter eine Route', gen: (v, c) => { c.doc.spec.host = v.HOST; } },
  { type: 'route_path', cat: 'network', shape: 'stmt', msg: 'Pfad %1', args: [T('PATH', '/')], scope: ['Route'], where: 'unter eine Route', gen: (v, c) => { c.doc.spec.path = v.PATH; } },
  {
    type: 'route_tls', cat: 'network', shape: 'stmt', msg: 'HTTPS %1 unsicheres HTTP %2', args: [D('TERM', ['edge', 'passthrough', 'reencrypt']), D('INSEC', [['umleiten', 'Redirect'], ['erlauben', 'Allow'], ['blockieren', 'None']])], scope: ['Route'], where: 'unter eine Route',
    gen: (v, c) => { c.doc.spec.tls = { termination: v.TERM, insecureEdgeTerminationPolicy: v.INSEC }; },
  },
  {
    type: 'ingress_rule', cat: 'network', shape: 'stmt', msg: 'Regel Host %1 Pfad %2 → Service %3 Port %4 Abgleich %5',
    args: [T('HOST', 'demo.example.com'), T('PATH', '/'), T('SVC', 'demo-app'), T('PORT', '80'), D('PTYPE', [['Präfix', 'Prefix'], ['exakt', 'Exact'], ['Controller', 'ImplementationSpecific']])], scope: ['Ingress'], where: 'unter einen Ingress',
    gen: (v, c) => {
      const pv = portVal(v.PORT);
      const path = { path: v.PATH || '/', pathType: v.PTYPE || 'Prefix', backend: { service: { name: v.SVC, port: typeof pv === 'number' ? { number: pv } : { name: pv } } } };
      const rules: any[] = c.doc.spec.rules;
      const existing = rules.find((r) => r.host === (v.HOST || undefined));
      if (existing) existing.http.paths.push(path);
      else rules.push({ host: v.HOST || undefined, http: { paths: [path] } });
    },
  },
  { type: 'ingress_tls', cat: 'network', shape: 'stmt', msg: 'TLS für %1 mit Secret %2', args: [T('HOST', 'demo.example.com'), T('SECRET', 'demo-tls')], scope: ['Ingress'], where: 'unter einen Ingress', gen: (v, c) => { c.doc.spec.tls.push({ hosts: [v.HOST], secretName: v.SECRET }); } },
  {
    type: 'ingress_annotation_ssl', cat: 'network', shape: 'stmt', msg: 'cert-manager Issuer %1', args: [T('ISSUER', 'letsencrypt')], scope: ['Ingress'], where: 'unter einen Ingress',
    gen: (v, c) => { at(c.doc.metadata, 'annotations')['cert-manager.io/cluster-issuer'] = v.ISSUER; },
  },
  { type: 'svc_k8s_headless', cat: 'network', shape: 'stmt', msg: 'Headless (keine Cluster-IP)', args: [], scope: ['Service'], where: 'unter einen Service', tip: 'clusterIP: None – DNS liefert direkt die Pod-IPs (z. B. für StatefulSets).', gen: (_v, c) => { c.doc.spec.clusterIP = 'None'; } },
  { type: 'svc_k8s_external', cat: 'network', shape: 'stmt', msg: 'externer DNS-Name %1', args: [T('HOST', 'db.example.com')], scope: ['Service'], where: 'unter einen Service (Typ ExternalName)', gen: (v, c) => { c.doc.spec.externalName = v.HOST; c.doc.spec.type = 'ExternalName'; delete c.doc.spec.selector; } },
];

// =====================================================================
// DATA (ConfigMap / Secret / PVC)
// =====================================================================
const data: BlockSpec[] = [
  {
    type: 'data_entry', cat: 'data', shape: 'stmt', msg: 'Eintrag %1 = %2', args: [T('K', 'APP_ENV'), M('V', 'production')], scope: ['ConfigMap', 'Secret'], where: 'unter eine ConfigMap oder ein Secret',
    gen: (v, c) => { (c.doc.kind === 'Secret' ? c.doc.stringData : c.doc.data)[v.K] = String(v.V); },
  },
  {
    type: 'data_registry', cat: 'data', shape: 'stmt', msg: 'Registry-Login %1 User %2 Token %3', args: [T('SERVER', 'registry.example.com'), T('USER', 'myuser'), T('PASS', 'replace-me')], scope: ['Secret'], where: 'unter ein Secret',
    tip: 'Erzeugt .dockerconfigjson (base64). Typ des Secrets wird automatisch gesetzt.',
    gen: (v, c) => {
      const auth = b64(`${v.USER}:${v.PASS}`);
      const cfg = { auths: { [v.SERVER]: { username: v.USER, password: v.PASS, auth } } };
      c.doc.type = 'kubernetes.io/dockerconfigjson';
      c.doc.data['.dockerconfigjson'] = b64(JSON.stringify(cfg));
    },
  },
  {
    type: 'data_base64', cat: 'data', shape: 'stmt', msg: 'Eintrag %1 = %2 als base64', args: [T('K', 'tls.crt'), T('V', 'REPLACE_WITH_BASE64')], scope: ['Secret', 'ConfigMap'], where: 'unter ein Secret',
    gen: (v, c) => { at(c.doc, c.doc.kind === 'ConfigMap' ? 'binaryData' : 'data')[v.K] = v.V; },
  },
  { type: 'pvc_class', cat: 'data', shape: 'stmt', msg: 'StorageClass %1', args: [T('SC', 'gp3-csi')], scope: ['PersistentVolumeClaim'], where: 'unter einen Speicher (PVC)', gen: (v, c) => { c.doc.spec.storageClassName = v.SC; } },
  { type: 'pvc_mode', cat: 'data', shape: 'stmt', msg: 'Volume-Modus %1', args: [D('M', ['Filesystem', 'Block'])], scope: ['PersistentVolumeClaim'], where: 'unter einen Speicher (PVC)', gen: (v, c) => { c.doc.spec.volumeMode = v.M; } },
  {
    type: 'sts_volume_claim', cat: 'data', shape: 'stmt', msg: 'pro Pod Speicher %1 Größe %2', args: [T('NAME', 'data'), T('SIZE', '10Gi')], scope: ['StatefulSet'], where: 'unter ein StatefulSet',
    gen: (v, c) => { list(c.doc.spec, 'volumeClaimTemplates').push({ metadata: { name: v.NAME }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: v.SIZE } } } }); },
  },
];

// =====================================================================
// BUILD (ImageStream / BuildConfig)
// =====================================================================
const build: BlockSpec[] = [
  {
    type: 'is_tag', cat: 'build', shape: 'stmt', msg: 'Tag %1 von externem Image %2', args: [T('TAG', 'latest'), T('FROM', 'quay.io/example/demo-app:1.0')], scope: ['ImageStream'], where: 'unter einen ImageStream',
    gen: (v, c) => { c.doc.spec.tags.push({ name: v.TAG, from: { kind: 'DockerImage', name: v.FROM } }); },
  },
  {
    type: 'bc_git', cat: 'build', shape: 'stmt', msg: 'Git Quelle %1 Branch %2 Unterordner %3', args: [T('URI', 'https://github.com/example/demo-app.git'), T('REF', 'main'), T('DIR', '')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { Object.assign(at(c.doc.spec, 'source'), { type: 'Git', git: { uri: v.URI, ref: v.REF || undefined }, contextDir: v.DIR || undefined }); },
  },
  { type: 'bc_source_secret', cat: 'build', shape: 'stmt', msg: 'Git-Zugang aus Secret %1', args: [T('S', 'git-credentials')], scope: ['BuildConfig'], where: 'unter eine BuildConfig', gen: (v, c) => { at(c.doc.spec, 'source').sourceSecret = { name: v.S }; } },
  {
    type: 'bc_docker', cat: 'build', shape: 'stmt', msg: 'Docker-Strategie Dockerfile %1', args: [T('FILE', 'Dockerfile')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { c.doc.spec.strategy = { type: 'Docker', dockerStrategy: { dockerfilePath: v.FILE || 'Dockerfile' } }; },
  },
  {
    type: 'bc_s2i', cat: 'build', shape: 'stmt', msg: 'S2I-Strategie Builder %1 aus Namespace %2', args: [T('IST', 'nodejs:20-ubi9'), T('NS', 'openshift')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { c.doc.spec.strategy = { type: 'Source', sourceStrategy: { from: { kind: 'ImageStreamTag', name: v.IST, namespace: v.NS || undefined } } }; },
  },
  {
    type: 'bc_build_arg', cat: 'build', shape: 'stmt', msg: 'Build-Variable %1 = %2', args: [T('K', 'NODE_ENV'), T('V', 'production')], scope: ['BuildConfig'], where: 'unter eine BuildConfig nach der Strategie',
    gen: (v, c) => {
      const st = c.doc.spec.strategy;
      if (!st) return c.warn('Erst eine Strategie-Block (Docker/S2I) darüber setzen.');
      const inner = st.dockerStrategy || st.sourceStrategy;
      list(inner, st.dockerStrategy ? 'buildArgs' : 'env').push({ name: v.K, value: v.V });
    },
  },
  {
    type: 'bc_trigger', cat: 'build', shape: 'stmt', msg: 'Build starten bei %1 Webhook-Secret %2',
    args: [D('T', [['Config-Änderung', 'ConfigChange'], ['neuem Basis-Image', 'ImageChange'], ['GitHub Push', 'GitHub'], ['GitLab Push', 'GitLab'], ['Generic Webhook', 'Generic']]), T('SECRET', '')],
    scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => {
      const t: any = { type: v.T };
      if (v.T === 'ImageChange') t.imageChange = {};
      if (['GitHub', 'GitLab', 'Generic'].includes(v.T)) t[v.T === 'GitHub' ? 'github' : v.T === 'GitLab' ? 'gitlab' : 'generic'] = { secretReference: { name: v.SECRET || 'webhook-secret' } };
      c.doc.spec.triggers.push(t);
    },
  },
  {
    type: 'bc_resources', cat: 'build', shape: 'stmt', msg: 'Build-Ressourcen CPU %1 RAM %2', args: [T('CPU', '500m'), T('MEM', '1Gi')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { c.doc.spec.resources = { limits: { cpu: v.CPU || undefined, memory: v.MEM || undefined } }; },
  },
  {
    type: 'bc_output', cat: 'build', shape: 'stmt', msg: 'Image schieben nach %1 %2 Push-Secret %3',
    args: [D('KIND', [['Registry (DockerImage)', 'DockerImage'], ['ImageStreamTag', 'ImageStreamTag']]), T('NAME', 'registry.example.com/team/demo-app:latest'), T('SECRET', '')],
    scope: ['BuildConfig'], where: 'unter eine BuildConfig', tip: 'Ersetzt das Ziel aus dem Startblock: externe Registry (DockerImage) mit Zugangsdaten aus einem Push-Secret.',
    gen: (v, c) => {
      const out = at(c.doc.spec, 'output');
      out.to = { kind: v.KIND, name: v.NAME };
      if (v.SECRET) out.pushSecret = { name: v.SECRET };
    },
  },
  {
    type: 'bc_output_label', cat: 'build', shape: 'stmt', msg: 'Image-Label %1 = %2', args: [T('K', 'io.openshift.build.source'), T('V', 'git')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { list(at(c.doc.spec, 'output'), 'imageLabels').push({ name: v.K, value: v.V }); },
  },
  {
    type: 'bc_pull_secret', cat: 'build', shape: 'stmt', msg: 'Basis-Image laden mit Pull-Secret %1', args: [T('S', 'registry-secret')], scope: ['BuildConfig'], where: 'unter eine BuildConfig nach der Strategie',
    tip: 'pullSecret der Strategie: Zugang zur Registry, aus der das FROM-Image im Dockerfile (bzw. der S2I-Builder) geladen wird.',
    gen: (v, c) => { const inner = strategyInner(c); if (inner) inner.pullSecret = { name: v.S }; },
  },
  {
    type: 'bc_strategy_opts', cat: 'build', shape: 'stmt', msg: 'ohne Cache bauen %1 Basis-Image immer neu laden %2', args: [C('NOCACHE', true), C('FORCE', false)], scope: ['BuildConfig'], where: 'unter eine BuildConfig nach der Strategie',
    gen: (v, c) => {
      const inner = strategyInner(c);
      if (!inner) return;
      if (v.NOCACHE && c.doc.spec.strategy.type === 'Docker') inner.noCache = true;
      if (v.FORCE) inner.forcePull = true;
    },
  },
  {
    type: 'bc_docker_from', cat: 'build', shape: 'stmt', msg: 'FROM im Dockerfile ersetzen durch %1 %2', args: [D('KIND', [['Registry (DockerImage)', 'DockerImage'], ['ImageStreamTag', 'ImageStreamTag']]), T('NAME', 'registry.access.redhat.com/ubi9/nodejs-20:latest')], scope: ['BuildConfig'], where: 'unter eine BuildConfig nach der Strategie',
    gen: (v, c) => { const inner = strategyInner(c); if (inner) inner.from = { kind: v.KIND, name: v.NAME }; },
  },
  {
    type: 'bc_strategy_env', cat: 'build', shape: 'stmt', msg: 'Umgebungsvariable im Build %1 = %2', args: [T('K', 'HTTP_PROXY'), T('V', '')], scope: ['BuildConfig'], where: 'unter eine BuildConfig nach der Strategie',
    tip: 'env der Docker-Strategie (im Unterschied zu Build-Variablen = --build-arg).',
    gen: (v, c) => { const inner = strategyInner(c); if (inner) list(inner, 'env').push({ name: v.K, value: v.V }); },
  },
  {
    type: 'bc_history', cat: 'build', shape: 'stmt', msg: 'Builds behalten: erfolgreiche %1 fehlgeschlagene %2', args: [T('OK', '2'), T('FAIL', '1')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    tip: 'successfulBuildsHistoryLimit / failedBuildsHistoryLimit – ältere Builds werden automatisch gelöscht.',
    gen: (v, c) => {
      if (v.OK !== '') c.doc.spec.successfulBuildsHistoryLimit = numOr(v.OK);
      if (v.FAIL !== '') c.doc.spec.failedBuildsHistoryLimit = numOr(v.FAIL);
    },
  },
  {
    type: 'bc_deadline', cat: 'build', shape: 'stmt', msg: 'Build abbrechen nach %1 Sekunden', args: [T('S', '1800')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { c.doc.spec.completionDeadlineSeconds = numOr(v.S); },
  },
  {
    type: 'bc_post_commit', cat: 'build', shape: 'stmt', msg: 'nach dem Build testen mit %1', args: [M('SCRIPT', 'npm test')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    tip: 'postCommit: läuft im fertigen Image, bevor es geschoben wird. Fehler = Build fehlgeschlagen.',
    gen: (v, c) => { c.doc.spec.postCommit = { script: v.SCRIPT }; },
  },
  {
    type: 'bc_node_selector', cat: 'build', shape: 'stmt', msg: 'Build nur auf Nodes mit %1 = %2', args: [T('K', 'node-role.kubernetes.io/worker'), T('V', '')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    gen: (v, c) => { at(c.doc.spec, 'nodeSelector')[v.K] = v.V; },
  },
  {
    type: 'bc_dockerfile', cat: 'build', shape: 'stmt', msg: 'Dockerfile direkt %1', args: [M('TEXT', 'FROM nginx:1.27\nCOPY . /usr/share/nginx/html\n')], scope: ['BuildConfig'], where: 'unter eine BuildConfig',
    tip: 'Dockerfile direkt in der BuildConfig (source.dockerfile) statt aus dem Git-Repo.',
    gen: (v, c) => {
      const src = at(c.doc.spec, 'source');
      src.dockerfile = v.TEXT;
      if (!src.type) src.type = 'Dockerfile';
    },
  },
];

/** dockerStrategy / sourceStrategy of the current BuildConfig (warns if no strategy block above). */
function strategyInner(c: Ctx): any {
  const st = c.doc.spec.strategy;
  if (!st) {
    c.warn('Erst einen Strategie-Block (Docker/S2I) darüber setzen.');
    return undefined;
  }
  return st.dockerStrategy || st.sourceStrategy;
}

// =====================================================================
// SCALING (HPA)
// =====================================================================
const scaling: BlockSpec[] = [
  {
    type: 'hpa_metric', cat: 'scaling', shape: 'stmt', msg: 'Ziel %1 Auslastung %2 %', args: [D('RES', [['CPU', 'cpu'], ['RAM', 'memory']]), N('PCT', 70, 1, 1)], scope: ['HorizontalPodAutoscaler'], where: 'unter einen Autoscaler',
    gen: (v, c) => { c.doc.spec.metrics.push({ type: 'Resource', resource: { name: v.RES, target: { type: 'Utilization', averageUtilization: v.PCT } } }); },
  },
  {
    type: 'hpa_behavior', cat: 'scaling', shape: 'stmt', msg: 'herunterskalieren erst nach %1 Sekunden Ruhe', args: [N('S', 300, 0, 1)], scope: ['HorizontalPodAutoscaler'], where: 'unter einen Autoscaler',
    gen: (v, c) => { at(c.doc.spec, 'behavior', 'scaleDown').stabilizationWindowSeconds = v.S; },
  },
];

// =====================================================================
// EXTRAS (escape hatches: anything is configurable)
// =====================================================================
function parseVal(s: string): any {
  if (s === '') return '';
  try { return YAML.parse(s); } catch { return s; }
}
const extras: BlockSpec[] = [
  {
    type: 'x_field', cat: 'extras', shape: 'stmt', msg: 'Feld %1 = %2', args: [T('PATH', 'spec.template.spec.hostNetwork'), T('VAL', 'true')],
    tip: 'Setzt ein beliebiges Feld (Pfad mit Punkten) im aktuellen Objekt: Ressource, Service oder Container. Werte wie 5, true, [a, b] werden erkannt.',
    gen: (v, c) => { if (v.PATH) setPath(c.target, v.PATH, parseVal(v.VAL)); },
  },
  {
    type: 'x_list', cat: 'extras', shape: 'stmt', msg: 'zu Liste %1 hinzufügen %2', args: [T('PATH', 'spec.template.spec.tolerations'), T('VAL', '{key: dedicated, operator: Exists}')],
    tip: 'Hängt einen Eintrag an eine Liste an.',
    gen: (v, c) => {
      const parts = v.PATH.split('.').filter(Boolean);
      const key = parts.pop();
      if (!key) return;
      const parent = parts.length ? at(c.target, ...parts) : c.target;
      list(parent, key).push(parseVal(v.VAL));
    },
  },
  {
    type: 'x_yaml', cat: 'extras', shape: 'stmt', msg: 'YAML einmischen %1', args: [M('Y', '{spec: {revisionHistoryLimit: 3}}')],
    tip: 'Mischt YAML (Flow-Schreibweise in einer Zeile) in das aktuelle Objekt.',
    gen: (v, c) => {
      try { deepMerge(c.target, YAML.parse(v.Y)); } catch (e: any) { c.warn('YAML-Fehler: ' + e.message); }
    },
  },
  { type: 'x_comment', cat: 'extras', shape: 'stmt', msg: 'Notiz %1', args: [T('TXT', 'Hier kommt noch was hin')], tip: 'Nur für dich – erscheint nicht im YAML.', gen: () => {} },
  {
    type: 'tpl_param', cat: 'extras', shape: 'stmt', msg: 'Template-Parameter %1 Standard %2 Pflicht %3 erzeugen aus %4 Beschreibung %5',
    args: [T('NAME', 'APP_NAME'), T('VALUE', ''), C('REQ', false), T('FROM', ''), T('DESC', '')], scope: ['Template'], where: 'unter ein OpenShift Template',
    tip: '"erzeugen aus": Regex für generierte Werte, z. B. [a-zA-Z0-9]{16} für Passwörter.',
    gen: (v, c) => { c.doc.parameters.push({ name: v.NAME, description: v.DESC || undefined, value: v.VALUE || undefined, generate: v.FROM ? 'expression' : undefined, from: v.FROM || undefined, required: v.REQ ? true : undefined }); },
  },
];

/** Force double quotes (avoids YAML 1.1 base-60 surprises like 22:22). */
function quoted(s: string) {
  const sc = new Scalar(s);
  sc.type = Scalar.QUOTE_DOUBLE;
  return sc;
}

/** "5" -> 5, "25%" -> "25%" */
function numOr(s: string): string | number {
  const t = String(s).trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** "0755" -> 493 (octal like kubectl/docker), "420" -> 420 */
function octOr(s: string): number | string {
  const t = String(s).trim();
  if (/^0[0-7]+$/.test(t)) return parseInt(t, 8);
  return numOr(t);
}

/** "a=b, c" -> [{key:a,path:b},{key:c,path:c}] */
function itemsOf(s: string): { key: string; path: string }[] | undefined {
  const items = String(s).split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [key, path] = x.split('=').map((y) => y.trim());
    return { key, path: path || key };
  });
  return items.length ? items : undefined;
}

function b64(s: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export const ALL_BLOCKS: BlockSpec[] = [...compose, ...service, ...resources, ...metadata, ...pod, ...container, ...network, ...data, ...build, ...scaling, ...extras];
export const SPEC_BY_TYPE: Record<string, BlockSpec> = Object.fromEntries(ALL_BLOCKS.map((b) => [b.type, b]));
