// Built-in snippets: small, reusable block combinations (not full projects).
import { b, B, chainJson } from './project';

export interface BuiltinSnippet {
  id: string;
  group: string;
  name: string;
  hint: string;
  kind: 'compose' | 'k8s';
  blocks: B[];
}

const S = (kind: 'compose' | 'k8s', group: string, name: string, hint: string, blocks: B[]): BuiltinSnippet => ({
  id: `${kind}:${name}`,
  group,
  name,
  hint,
  kind,
  blocks,
});

export const BUILTIN_SNIPPETS: BuiltinSnippet[] = [
  // ---------------- Compose: services ----------------
  S('compose', 'Datenbanken', 'PostgreSQL', 'Service mit Volume, Healthcheck und Restart', [
    b('compose_service', { NAME: 'db', IMAGE: 'postgres:16-alpine' }, [
      b('svc_env', { K: 'POSTGRES_USER', V: 'app' }),
      b('svc_env', { K: 'POSTGRES_PASSWORD', V: 'change-me' }),
      b('svc_env', { K: 'POSTGRES_DB', V: 'app' }),
      b('svc_volume', { SRC: 'pgdata', DST: '/var/lib/postgresql/data', RO: false }),
      b('svc_healthcheck', { CMD: 'pg_isready -U app', INT: '10s', TO: '5s', RET: 5 }),
      b('svc_restart', { R: 'unless-stopped' }),
    ]),
    b('compose_volume', { NAME: 'pgdata', DRIVER: '__none__' }),
  ]),
  S('compose', 'Datenbanken', 'MariaDB', 'Service mit Volume und Healthcheck', [
    b('compose_service', { NAME: 'mariadb', IMAGE: 'mariadb:11' }, [
      b('svc_env', { K: 'MARIADB_ROOT_PASSWORD', V: 'change-me' }),
      b('svc_env', { K: 'MARIADB_DATABASE', V: 'app' }),
      b('svc_volume', { SRC: 'mariadb', DST: '/var/lib/mysql', RO: false }),
      b('svc_healthcheck', { CMD: 'healthcheck.sh --connect --innodb_initialized', INT: '10s', TO: '5s', RET: 5 }),
      b('svc_restart', { R: 'unless-stopped' }),
    ]),
    b('compose_volume', { NAME: 'mariadb', DRIVER: '__none__' }),
  ]),
  S('compose', 'Datenbanken', 'Redis (persistent)', 'AOF-Persistenz und Volume', [
    b('compose_service', { NAME: 'redis', IMAGE: 'redis:7-alpine' }, [
      b('svc_command', { CMD: 'redis-server --appendonly yes' }),
      b('svc_volume', { SRC: 'redis', DST: '/data', RO: false }),
      b('svc_healthcheck', { CMD: 'redis-cli ping', INT: '10s', TO: '3s', RET: 5 }),
      b('svc_restart', { R: 'unless-stopped' }),
    ]),
    b('compose_volume', { NAME: 'redis', DRIVER: '__none__' }),
  ]),
  S('compose', 'Web', 'App aus Dockerfile', 'Build, Port, Env, wartet auf gesunde DB', [
    b('compose_service', { NAME: 'app', IMAGE: '' }, [
      b('svc_build', { CTX: '.', FILE: 'Dockerfile' }),
      b('svc_port', { HOST: '8080', CONT: '3000', PROTO: 'tcp' }),
      b('svc_env_file', { FILE: '.env' }),
      b('svc_depends', { NAME: 'db', COND: 'service_healthy' }),
      b('svc_restart', { R: 'unless-stopped' }),
    ]),
  ]),
  S('compose', 'Web', 'Nginx Reverse Proxy', 'Ports 80/443 und Config read-only', [
    b('compose_service', { NAME: 'proxy', IMAGE: 'nginx:1.27-alpine' }, [
      b('svc_port', { HOST: '80', CONT: '80', PROTO: 'tcp' }),
      b('svc_port', { HOST: '443', CONT: '443', PROTO: 'tcp' }),
      b('svc_volume', { SRC: './nginx.conf', DST: '/etc/nginx/nginx.conf', RO: true }),
      b('svc_volume', { SRC: './certs', DST: '/etc/nginx/certs', RO: true }),
      b('svc_restart', { R: 'unless-stopped' }),
    ]),
  ]),
  S('compose', 'Web', 'Traefik Labels', 'Routing-Labels für einen Service (in Service legen)', [
    b('svc_label', { K: 'traefik.enable', V: 'true' }),
    b('svc_label', { K: 'traefik.http.routers.app.rule', V: 'Host(`app.example.com`)' }),
    b('svc_label', { K: 'traefik.http.routers.app.entrypoints', V: 'websecure' }),
    b('svc_label', { K: 'traefik.http.routers.app.tls.certresolver', V: 'le' }),
    b('svc_label', { K: 'traefik.http.services.app.loadbalancer.server.port', V: '3000' }),
  ]),
  S('compose', 'Tools', 'Adminer', 'DB-Weboberfläche auf Port 8081', [
    b('compose_service', { NAME: 'adminer', IMAGE: 'adminer:4' }, [b('svc_port', { HOST: '8081', CONT: '8080', PROTO: 'tcp' }), b('svc_depends', { NAME: 'db', COND: 'service_started' })]),
  ]),
  S('compose', 'Tools', 'Mailpit (Dev-Mail)', 'SMTP 1025, Web-UI 8025', [
    b('compose_service', { NAME: 'mailpit', IMAGE: 'axllent/mailpit:latest' }, [
      b('svc_port', { HOST: '8025', CONT: '8025', PROTO: 'tcp' }),
      b('svc_port', { HOST: '1025', CONT: '1025', PROTO: 'tcp' }),
      b('svc_profile', { P: 'dev' }),
    ]),
  ]),
  S('compose', 'Betrieb', 'HTTP-Healthcheck', 'curl gegen /health (in Service legen)', [b('svc_healthcheck', { CMD: 'curl -fsS http://localhost:3000/health || exit 1', INT: '30s', TO: '5s', RET: 3 })]),
  S('compose', 'Betrieb', 'Log-Rotation', 'json-file 10 MB × 3 (in Service legen)', [b('svc_logging', { DRV: 'json-file', SIZE: '10m', FILES: 3 })]),
  S('compose', 'Betrieb', 'Ressourcen-Limits', 'CPU/RAM-Limit und Replicas (in Service legen)', [b('svc_resources', { CPU: '1.0', MEM: '512M' }), b('svc_replicas', { N: 2 })]),
  S('compose', 'Betrieb', 'Gehärteter Service', 'read-only, init, non-root (in Service legen)', [
    b('svc_flag', { K: 'read_only' }),
    b('svc_flag', { K: 'init' }),
    b('svc_option', { K: 'user', V: '1000:1000' }),
    b('x_field', { PATH: 'security_opt', VAL: '["no-new-privileges:true"]' }),
    b('x_field', { PATH: 'cap_drop', VAL: '[ALL]' }),
  ]),
  S('compose', 'Betrieb', 'Frontend/Backend-Netze', 'Zwei getrennte Netzwerke', [
    b('compose_network', { NAME: 'frontend', DRIVER: 'bridge', EXTERNAL: false }),
    b('compose_network', { NAME: 'backend', DRIVER: 'bridge', EXTERNAL: false }),
  ]),

  // ---------------- Kubernetes: workloads ----------------
  S('k8s', 'Workloads', 'Web-Deployment', 'Container mit Port, Ressourcen und Probes', [
    b('k8s_deployment', { NAME: 'web', REPLICAS: 2 }),
    b('pod_container', { NAME: 'web', IMAGE: 'registry.example.com/web:1.0' }, [
      b('c_port', { PORT: 8080, NAME: 'http', PROTO: 'TCP' }),
      b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' }),
      b('c_resources', { KIND: 'limits', CPU: '500m', MEM: '512Mi' }),
      b('c_probe', { KIND: 'readinessProbe', HOW: 'http', PATH: '/ready', PORT: 'http', DELAY: 5, PERIOD: 10 }),
      b('c_probe', { KIND: 'livenessProbe', HOW: 'http', PATH: '/healthz', PORT: 'http', DELAY: 15, PERIOD: 20 }),
    ]),
  ]),
  S('k8s', 'Workloads', 'PostgreSQL StatefulSet', 'Mit Speicher pro Pod und Secret-Passwort', [
    b('k8s_statefulset', { NAME: 'postgres', REPLICAS: 1, SVC: 'postgres' }),
    b('sts_volume_claim', { NAME: 'data', SIZE: '10Gi' }),
    b('pod_container', { NAME: 'postgres', IMAGE: 'postgres:16' }, [
      b('c_port', { PORT: 5432, NAME: 'pg', PROTO: 'TCP' }),
      b('c_env_ref', { K: 'POSTGRES_PASSWORD', SRC: 'secretKeyRef', NAME: 'postgres', KEY: 'password' }),
      b('c_env', { K: 'PGDATA', V: '/var/lib/postgresql/data/pgdata' }),
      b('c_mount', { NAME: 'data', PATH: '/var/lib/postgresql/data', RO: false }),
    ]),
  ]),
  S('k8s', 'Workloads', 'CronJob Backup', 'Nächtlich 02:00, kein paralleler Lauf', [
    b('k8s_cronjob', { NAME: 'backup', SCHEDULE: '0 2 * * *' }),
    b('x_field', { PATH: 'spec.concurrencyPolicy', VAL: 'Forbid' }),
    b('pod_container', { NAME: 'backup', IMAGE: 'alpine:3.20' }, [b('c_command', { CMD: '/bin/sh -c "echo backup"' })]),
  ]),
  S('k8s', 'Workloads', 'Job DB-Migration', 'Einmaliger Job mit Secret-Env', [
    b('k8s_job', { NAME: 'migrate', BACKOFF: 2 }),
    b('pod_container', { NAME: 'migrate', IMAGE: 'registry.example.com/web:1.0' }, [
      b('c_command', { CMD: 'bin/migrate --all' }),
      b('c_env_from', { SRC: 'secretRef', NAME: 'db-credentials' }),
    ]),
  ]),
  S('k8s', 'Pod', 'Init-Container: auf DB warten', 'Wartet bis Port 5432 erreichbar ist (unter Deployment)', [
    b('pod_init_container', { NAME: 'wait-for-db', IMAGE: 'busybox:1.36' }, [b('c_command', { CMD: '/bin/sh -c "until nc -z postgres 5432; do sleep 2; done"' })]),
  ]),
  S('k8s', 'Pod', 'PVC einhängen', 'Volume aus PVC + Container-Mount (unter Deployment)', [
    b('pod_vol_pvc', { NAME: 'data', CLAIM: 'app-data' }),
    b('pod_container', { NAME: 'app', IMAGE: 'nginx:latest' }, [b('c_mount', { NAME: 'data', PATH: '/data', RO: false })]),
  ]),
  S('k8s', 'Pod', 'Prometheus-Scraping', 'Pod-Annotationen (unter Deployment)', [
    b('pod_annotation', { K: 'prometheus.io/scrape', V: 'true' }),
    b('pod_annotation', { K: 'prometheus.io/port', V: '9090' }),
    b('pod_annotation', { K: 'prometheus.io/path', V: '/metrics' }),
  ]),
  S('k8s', 'Pod', 'Pods verteilen', 'Anti-Affinity über Nodes (unter Deployment)', [
    b('x_field', {
      PATH: 'spec.template.spec.topologySpreadConstraints',
      VAL: '[{maxSkew: 1, topologyKey: kubernetes.io/hostname, whenUnsatisfiable: ScheduleAnyway, labelSelector: {matchLabels: {app: web}}}]',
    }),
  ]),
  S('k8s', 'Pod', 'Dedizierte Nodes', 'nodeSelector + Toleration (unter Deployment)', [
    b('pod_node_selector', { K: 'node-role.kubernetes.io/app', V: '' }),
    b('x_list', { PATH: 'spec.template.spec.tolerations', VAL: '{key: dedicated, operator: Equal, value: app, effect: NoSchedule}' }),
  ]),
  S('k8s', 'Pod', 'Non-root Pod', 'runAsNonRoot + fsGroup (unter Deployment)', [b('pod_security', { NONROOT: true, FSGROUP: '1000' })]),

  // ---------------- Kubernetes: container ----------------
  S('k8s', 'Container', 'Config aus ConfigMap + Secret', 'envFrom für beide (in Container legen)', [
    b('c_env_from', { SRC: 'configMapRef', NAME: 'app-config' }),
    b('c_env_from', { SRC: 'secretRef', NAME: 'app-secret' }),
  ]),
  S('k8s', 'Container', 'Probes-Set', 'Startup, Liveness, Readiness (in Container legen)', [
    b('c_probe', { KIND: 'startupProbe', HOW: 'http', PATH: '/healthz', PORT: '8080', DELAY: 0, PERIOD: 5 }),
    b('c_probe', { KIND: 'livenessProbe', HOW: 'http', PATH: '/healthz', PORT: '8080', DELAY: 0, PERIOD: 20 }),
    b('c_probe', { KIND: 'readinessProbe', HOW: 'http', PATH: '/ready', PORT: '8080', DELAY: 0, PERIOD: 10 }),
  ]),
  S('k8s', 'Container', 'Requests & Limits', 'Kleine Standardgröße (in Container legen)', [
    b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' }),
    b('c_resources', { KIND: 'limits', CPU: '500m', MEM: '512Mi' }),
  ]),
  S('k8s', 'Container', 'Gehärteter Container', 'Keine Eskalation, read-only FS, Caps weg (in Container legen)', [
    b('c_security', { NOESC: true, ROFS: true, DROP: true }),
    b('x_field', { PATH: 'securityContext.seccompProfile', VAL: '{type: RuntimeDefault}' }),
  ]),
  S('k8s', 'Container', 'Downward API: Pod-Infos', 'POD_NAME, POD_NAMESPACE als Env (in Container legen)', [
    b('x_list', { PATH: 'env', VAL: '{name: POD_NAME, valueFrom: {fieldRef: {fieldPath: metadata.name}}}' }),
    b('x_list', { PATH: 'env', VAL: '{name: POD_NAMESPACE, valueFrom: {fieldRef: {fieldPath: metadata.namespace}}}' }),
  ]),

  // ---------------- Kubernetes: networking ----------------
  S('k8s', 'Netzwerk', 'Service HTTP', 'ClusterIP 80 → 8080', [b('k8s_service', { NAME: 'web', APP: 'web', TYPE: 'ClusterIP' }), b('svc_k8s_port', { PORT: 80, TARGET: '8080', NAME: 'http', PROTO: 'TCP' })]),
  S('k8s', 'Netzwerk', 'Route HTTPS (OpenShift)', 'Edge-TLS, HTTP → HTTPS', [b('k8s_route', { NAME: 'web', SVC: 'web', PORT: 'http' }), b('route_tls', { TERM: 'edge', INSEC: 'Redirect' })]),
  S('k8s', 'Netzwerk', 'Ingress mit TLS', 'nginx + cert-manager', [
    b('k8s_ingress', { NAME: 'web', CLASS: 'nginx' }),
    b('ingress_annotation_ssl', { ISSUER: 'letsencrypt' }),
    b('ingress_tls', { HOST: 'app.example.com', SECRET: 'web-tls' }),
    b('ingress_rule', { HOST: 'app.example.com', PATH: '/', SVC: 'web', PORT: '80' }),
  ]),
  S('k8s', 'Netzwerk', 'NetworkPolicy: alles blocken', 'Default-deny für den Namespace', [
    b('k8s_custom', { NAME: 'default-deny', KIND: 'NetworkPolicy', API: 'networking.k8s.io/v1' }),
    b('x_field', { PATH: 'spec.podSelector', VAL: '{}' }),
    b('x_field', { PATH: 'spec.policyTypes', VAL: '[Ingress, Egress]' }),
  ]),
  S('k8s', 'Netzwerk', 'NetworkPolicy: vom Router', 'Erlaubt OpenShift-Router-Traffic', [
    b('k8s_custom', { NAME: 'allow-from-router', KIND: 'NetworkPolicy', API: 'networking.k8s.io/v1' }),
    b('x_field', { PATH: 'spec.podSelector', VAL: '{}' }),
    b('x_list', { PATH: 'spec.ingress', VAL: '{from: [{namespaceSelector: {matchLabels: {network.openshift.io/policy-group: ingress}}}]}' }),
    b('x_field', { PATH: 'spec.policyTypes', VAL: '[Ingress]' }),
  ]),

  // ---------------- Kubernetes: config & storage ----------------
  S('k8s', 'Config & Speicher', 'ConfigMap App-Settings', 'Typische Einträge', [
    b('k8s_configmap', { NAME: 'app-config' }),
    b('data_entry', { K: 'APP_ENV', V: 'production' }),
    b('data_entry', { K: 'LOG_LEVEL', V: 'info' }),
  ]),
  S('k8s', 'Config & Speicher', 'Secret Zugangsdaten', 'Opaque mit stringData', [
    b('k8s_secret', { NAME: 'app-secret', TYPE: 'Opaque' }),
    b('data_entry', { K: 'DB_USERNAME', V: 'app' }),
    b('data_entry', { K: 'DB_PASSWORD', V: 'change-me' }),
  ]),
  S('k8s', 'Config & Speicher', 'Registry Pull-Secret', 'dockerconfigjson für private Registry', [
    b('k8s_secret', { NAME: 'registry-credentials', TYPE: 'kubernetes.io/dockerconfigjson' }),
    b('data_registry', { SERVER: 'registry.example.com', USER: 'robot', PASS: 'change-me' }),
  ]),
  S('k8s', 'Config & Speicher', 'PVC 10 Gi', 'Mit StorageClass', [b('k8s_pvc', { NAME: 'app-data', SIZE: '10Gi', MODE: 'ReadWriteOnce' }), b('pvc_class', { SC: 'standard' })]),
  S('k8s', 'Config & Speicher', 'Namespace mit Labels', 'Inkl. Pod-Security-Level', [
    b('k8s_namespace', { NAME: 'my-app' }),
    b('meta_label', { K: 'pod-security.kubernetes.io/enforce', V: 'restricted' }),
    b('meta_label', { K: 'app.kubernetes.io/part-of', V: 'my-app' }),
  ]),

  // ---------------- OpenShift build & scaling ----------------
  S('k8s', 'Build & Skalierung', 'ImageStream', 'Ziel für Builds', [b('k8s_imagestream', { NAME: 'app', LOCAL: true })]),
  S('k8s', 'Build & Skalierung', 'BuildConfig Docker + Webhook', 'Git → Dockerfile → ImageStream', [
    b('k8s_buildconfig', { NAME: 'app-build', OUT: 'app:latest', RUN: 'Serial' }),
    b('bc_git', { URI: 'https://github.com/example/app.git', REF: 'main', DIR: '' }),
    b('bc_docker', { FILE: 'Dockerfile' }),
    b('bc_trigger', { T: 'ConfigChange', SECRET: '' }),
    b('bc_trigger', { T: 'GitHub', SECRET: 'github-webhook' }),
  ]),
  S('k8s', 'Build & Skalierung', 'BuildConfig S2I Node.js', 'Source-to-Image mit Builder aus openshift', [
    b('k8s_buildconfig', { NAME: 'app-build', OUT: 'app:latest', RUN: 'Serial' }),
    b('bc_git', { URI: 'https://github.com/example/app.git', REF: 'main', DIR: '' }),
    b('bc_s2i', { IST: 'nodejs:20-ubi9', NS: 'openshift' }),
    b('bc_trigger', { T: 'ConfigChange', SECRET: '' }),
    b('bc_trigger', { T: 'ImageChange', SECRET: '' }),
  ]),
  S('k8s', 'Build & Skalierung', 'Image-Trigger', 'Deployment folgt ImageStreamTag (unter Deployment)', [b('meta_image_trigger', { IST: 'app:latest', CONT: 'app' })]),
  S('k8s', 'Build & Skalierung', 'Autoscaler CPU + RAM', '2–10 Pods, ruhiges Herunterskalieren', [
    b('k8s_hpa', { NAME: 'web', TARGET: 'web', MIN: 2, MAX: 10 }),
    b('hpa_metric', { RES: 'cpu', PCT: 70 }),
    b('hpa_metric', { RES: 'memory', PCT: 80 }),
    b('hpa_behavior', { S: 300 }),
  ]),
];

export function snippetState(s: BuiltinSnippet) {
  return chainJson(s.blocks);
}
