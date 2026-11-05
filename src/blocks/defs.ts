// All BYOBYaml blocks. Each block = look (msg/args) + what it writes into the YAML (gen).
import YAML, { Scalar } from 'yaml';
import { at, BlockSpec, C, Ctx, D, deepMerge, list, N, portVal, setPath, splitArgs, T } from './types';

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
    msg: 'Secret %1 aus Datei %2',
    args: [T('NAME', 'db_password'), T('FILE', './secrets/db_password.txt')],
    scope: ['compose'],
    where: 'unter einen "Docker Compose"-Startblock',
    gen: (v, ctx) => {
      at(ctx.doc, 'secrets')[v.NAME] = { file: v.FILE };
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
  { type: 'svc_env_file', cat: 'service', shape: 'stmt', msg: 'Variablen aus Datei %1', args: [T('FILE', '.env')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'env_file').push(v.FILE); } },
  {
    type: 'svc_volume', cat: 'service', shape: 'stmt', msg: 'Volume %1 → %2 nur lesen %3', args: [T('SRC', 'data'), T('DST', '/var/lib/data'), C('RO', false)], scope: S, where: SW,
    gen: (v, c) => { list(c.target, 'volumes').push(`${v.SRC}:${v.DST}${v.RO ? ':ro' : ''}`); },
  },
  {
    type: 'svc_depends', cat: 'service', shape: 'stmt', msg: 'wartet auf %1 bis %2', args: [T('NAME', 'db'), D('COND', [['gestartet', 'service_started'], ['gesund', 'service_healthy'], ['fertig', 'service_completed_successfully']])], scope: S, where: SW,
    gen: (v, c) => { at(c.target, 'depends_on')[v.NAME] = { condition: v.COND }; },
  },
  { type: 'svc_restart', cat: 'service', shape: 'stmt', msg: 'Neustart %1', args: [D('R', ['unless-stopped', 'always', 'on-failure', 'no'])], scope: S, where: SW, gen: (v, c) => { c.target.restart = v.R; } },
  { type: 'svc_command', cat: 'service', shape: 'stmt', msg: 'Command %1', args: [T('CMD', 'npm start')], scope: S, where: SW, gen: (v, c) => { c.target.command = splitArgs(v.CMD); } },
  { type: 'svc_entrypoint', cat: 'service', shape: 'stmt', msg: 'Entrypoint %1', args: [T('CMD', '/docker-entrypoint.sh')], scope: S, where: SW, gen: (v, c) => { c.target.entrypoint = splitArgs(v.CMD); } },
  { type: 'svc_network', cat: 'service', shape: 'stmt', msg: 'im Netzwerk %1', args: [T('NAME', 'backend')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'networks').push(v.NAME); } },
  {
    type: 'svc_healthcheck', cat: 'service', shape: 'stmt', msg: 'Healthcheck %1 %2 alle %3 Timeout %4 Versuche %5 Startphase %6',
    args: [D('MODE', [['Shell (CMD-SHELL)', 'CMD-SHELL'], ['Befehl (CMD)', 'CMD']]), T('CMD', 'curl -f http://localhost/ || exit 1'), T('INT', '30s'), T('TO', '5s'), N('RET', 3, 0), T('START', '')],
    scope: S, where: SW,
    tip: 'Shell: Befehl läuft in /bin/sh. Befehl (CMD): direkt ausgeführt, Argumente mit Leerzeichen in Anführungszeichen setzen.',
    gen: (v, c) => {
      const hc: any = { test: v.MODE === 'CMD' ? ['CMD', ...splitArgs(v.CMD)] : ['CMD-SHELL', v.CMD] };
      if (v.INT) hc.interval = v.INT;
      if (v.TO) hc.timeout = v.TO;
      if (v.RET !== '') hc.retries = v.RET;
      if (v.START) hc.start_period = v.START;
      c.target.healthcheck = hc;
    },
  },
  { type: 'svc_healthcheck_off', cat: 'service', shape: 'stmt', msg: 'Healthcheck ausschalten', args: [], scope: S, where: SW, tip: 'Schaltet einen im Image definierten Healthcheck ab (disable: true).', gen: (_v, c) => { c.target.healthcheck = { disable: true }; } },
  { type: 'svc_label', cat: 'service', shape: 'stmt', msg: 'Label %1 = %2', args: [T('K', 'com.example.team'), T('V', 'platform')], scope: S, where: SW, gen: (v, c) => { at(c.target, 'labels')[v.K] = v.V; } },
  {
    type: 'svc_resources', cat: 'service', shape: 'stmt', msg: 'Limit CPU %1 RAM %2', args: [T('CPU', '0.5'), T('MEM', '512M')], scope: S, where: SW,
    gen: (v, c) => {
      const lim = at(c.target, 'deploy', 'resources', 'limits');
      if (v.CPU) lim.cpus = v.CPU;
      if (v.MEM) lim.memory = v.MEM;
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
  { type: 'svc_secret', cat: 'service', shape: 'stmt', msg: 'nutzt Secret %1', args: [T('NAME', 'db_password')], scope: S, where: SW, gen: (v, c) => { list(c.target, 'secrets').push(v.NAME); } },
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
      if (!spec.ports.length) ctx.warn(`Service "${v.NAME}" hat noch keinen Port-Block.`);
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
    tip: 'OpenShift BuildConfig: baut ein Image aus Git und schiebt es in einen ImageStream.',
    gen: (v, ctx, run) => {
      const spec: any = { runPolicy: v.RUN, source: undefined, strategy: undefined, output: { to: { kind: 'ImageStreamTag', name: v.OUT } }, triggers: [] };
      const doc = newDoc(ctx, 'build.openshift.io/v1', 'BuildConfig', v.NAME, spec);
      run(['k8s', 'BuildConfig'], { doc, target: doc });
      if (!spec.source) ctx.warn('BuildConfig braucht eine Quelle (z.B. Git).');
      if (!spec.strategy) ctx.warn('BuildConfig braucht eine Strategie (Docker oder S2I).');
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
  { type: 'pod_vol_cm', cat: 'pod', shape: 'stmt', msg: 'Volume %1 aus ConfigMap %2', args: [T('NAME', 'config'), T('CM', 'demo-app-config')], scope: P, where: PW, gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, configMap: { name: v.CM } }); } },
  { type: 'pod_vol_secret', cat: 'pod', shape: 'stmt', msg: 'Volume %1 aus Secret %2', args: [T('NAME', 'certs'), T('SECRET', 'demo-app-tls')], scope: P, where: PW, gen: (v, c) => { list(c.pod, 'volumes').push({ name: v.NAME, secret: { secretName: v.SECRET } }); } },
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
    type: 'pod_security', cat: 'pod', shape: 'stmt', msg: 'Pod läuft nicht als root %1 fsGroup %2', args: [C('NONROOT', true), T('FSGROUP', '')], scope: P, where: PW,
    gen: (v, c) => {
      const sc = at(c.pod, 'securityContext');
      sc.runAsNonRoot = !!v.NONROOT;
      if (v.FSGROUP) sc.fsGroup = Number(v.FSGROUP) || v.FSGROUP;
    },
  },
  { type: 'pod_grace', cat: 'pod', shape: 'stmt', msg: 'Beenden-Wartezeit %1 Sekunden', args: [N('S', 30, 0, 1)], scope: P, where: PW, gen: (v, c) => { c.pod.terminationGracePeriodSeconds = v.S; } },
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
    type: 'c_env_ref', cat: 'container', shape: 'stmt', msg: 'Variable %1 aus %2 %3 Schlüssel %4',
    args: [T('K', 'DB_PASSWORD'), D('SRC', [['Secret', 'secretKeyRef'], ['ConfigMap', 'configMapKeyRef']]), T('NAME', 'demo-app-secret'), T('KEY', 'DB_PASSWORD')], scope: K, where: KW,
    gen: (v, c) => { list(c.container, 'env').push({ name: v.K, valueFrom: { [v.SRC]: { name: v.NAME, key: v.KEY } } }); },
  },
  {
    type: 'c_env_from', cat: 'container', shape: 'stmt', msg: 'alle Variablen aus %1 %2', args: [D('SRC', [['ConfigMap', 'configMapRef'], ['Secret', 'secretRef']]), T('NAME', 'demo-app-config')], scope: K, where: KW,
    gen: (v, c) => { list(c.container, 'envFrom').push({ [v.SRC]: { name: v.NAME } }); },
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
    type: 'c_mount', cat: 'container', shape: 'stmt', msg: 'Volume %1 einhängen in %2 nur lesen %3', args: [T('NAME', 'data'), T('PATH', '/data'), C('RO', false)], scope: K, where: KW,
    gen: (v, c) => { list(c.container, 'volumeMounts').push({ name: v.NAME, mountPath: v.PATH, readOnly: v.RO ? true : undefined }); },
  },
  { type: 'c_command', cat: 'container', shape: 'stmt', msg: 'Command %1', args: [T('CMD', '/bin/sh -c "echo hallo"')], scope: K, where: KW, gen: (v, c) => { c.container.command = splitArgs(v.CMD); } },
  { type: 'c_args', cat: 'container', shape: 'stmt', msg: 'Argumente %1', args: [T('ARGS', '--port 8080')], scope: K, where: KW, gen: (v, c) => { c.container.args = splitArgs(v.ARGS); } },
  { type: 'c_pull', cat: 'container', shape: 'stmt', msg: 'Image laden %1', args: [D('P', ['IfNotPresent', 'Always', 'Never'])], scope: K, where: KW, gen: (v, c) => { c.container.imagePullPolicy = v.P; } },
  { type: 'c_workdir', cat: 'container', shape: 'stmt', msg: 'Arbeitsordner %1', args: [T('DIR', '/app')], scope: K, where: KW, gen: (v, c) => { c.container.workingDir = v.DIR; } },
  {
    type: 'c_probe', cat: 'container', shape: 'stmt', msg: '%1 prüfen per %2 Pfad %3 Port %4 nach %5 s alle %6 s Timeout %7 s Fehlversuche %8',
    args: [D('KIND', [['Lebt? (liveness)', 'livenessProbe'], ['Bereit? (readiness)', 'readinessProbe'], ['Gestartet? (startup)', 'startupProbe']]), D('HOW', [['HTTP GET', 'http'], ['TCP', 'tcp']]), T('PATH', '/healthz'), T('PORT', '8080'), N('DELAY', 5, 0, 1), N('PERIOD', 10, 1, 1), T('TIMEOUT', ''), T('FAIL', '')],
    scope: K, where: KW,
    gen: (v, c) => {
      const probe: any = v.HOW === 'http' ? { httpGet: { path: v.PATH || '/', port: portVal(v.PORT) } } : { tcpSocket: { port: portVal(v.PORT) } };
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
    type: 'ingress_rule', cat: 'network', shape: 'stmt', msg: 'Regel Host %1 Pfad %2 → Service %3 Port %4',
    args: [T('HOST', 'demo.example.com'), T('PATH', '/'), T('SVC', 'demo-app'), T('PORT', '80')], scope: ['Ingress'], where: 'unter einen Ingress',
    gen: (v, c) => {
      const pv = portVal(v.PORT);
      const path = { path: v.PATH || '/', pathType: 'Prefix', backend: { service: { name: v.SVC, port: typeof pv === 'number' ? { number: pv } : { name: pv } } } };
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
];

// =====================================================================
// DATA (ConfigMap / Secret / PVC)
// =====================================================================
const data: BlockSpec[] = [
  {
    type: 'data_entry', cat: 'data', shape: 'stmt', msg: 'Eintrag %1 = %2', args: [T('K', 'APP_ENV'), T('V', 'production')], scope: ['ConfigMap', 'Secret'], where: 'unter eine ConfigMap oder ein Secret',
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
    gen: (v, c) => { c.doc.spec.source = { type: 'Git', git: { uri: v.URI, ref: v.REF || undefined }, contextDir: v.DIR || undefined }; },
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
];

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
    type: 'x_yaml', cat: 'extras', shape: 'stmt', msg: 'YAML einmischen %1', args: [T('Y', '{spec: {revisionHistoryLimit: 3}}')],
    tip: 'Mischt YAML (Flow-Schreibweise in einer Zeile) in das aktuelle Objekt.',
    gen: (v, c) => {
      try { deepMerge(c.target, YAML.parse(v.Y)); } catch (e: any) { c.warn('YAML-Fehler: ' + e.message); }
    },
  },
  { type: 'x_comment', cat: 'extras', shape: 'stmt', msg: 'Notiz %1', args: [T('TXT', 'Hier kommt noch was hin')], tip: 'Nur für dich – erscheint nicht im YAML.', gen: () => {} },
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

function b64(s: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export const ALL_BLOCKS: BlockSpec[] = [...compose, ...service, ...resources, ...metadata, ...pod, ...container, ...network, ...data, ...build, ...scaling, ...extras];
export const SPEC_BY_TYPE: Record<string, BlockSpec> = Object.fromEntries(ALL_BLOCKS.map((b) => [b.type, b]));
