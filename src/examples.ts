import { b, file, Project, stack, uid } from './project';

export function openshiftDemo(): Project {
  return {
    format: 'byobyaml',
    version: 2,
    id: uid(),
    title: 'OpenShift Demo-App',
    envs: ['dev', 'prod'],
    activeEnv: 'dev',
    variables: [
      { name: 'APP', values: { dev: 'demo-app', prod: 'demo-app' } },
      { name: 'NAMESPACE', values: { dev: 'demo-dev', prod: 'demo-prod' } },
      { name: 'REPLICAS', values: { dev: '1', prod: '3' } },
    ],
    files: [
      file('01-namespace.yaml', 'k8s', stack(b('k8s_namespace', { NAME: '${NAMESPACE}' }), [b('meta_label', { K: 'app.kubernetes.io/part-of', V: 'demo-app' })])),
      file('02-imagestream.yaml', 'k8s', stack(b('k8s_imagestream', { NAME: 'demo-app', LOCAL: false }), [])),
      file(
        '03-buildconfig.yaml',
        'k8s',
        stack(b('k8s_buildconfig', { NAME: 'demo-app-build', OUT: 'demo-app:latest', RUN: 'Serial' }), [
          b('bc_git', { URI: 'https://github.com/example/demo-app.git', REF: 'main', DIR: '' }),
          b('bc_docker', { FILE: 'Dockerfile' }),
          b('bc_trigger', { T: 'ConfigChange', SECRET: '' }),
        ]),
      ),
      file(
        '04-deployment.yaml',
        'k8s',
        stack(b('k8s_deployment', { NAME: '${APP}', REPLICAS: '${REPLICAS}' }), [
          b('meta_image_trigger', { IST: 'demo-app:latest', CONT: 'demo-app' }),
          b('pod_pull_secret', { NAME: 'registry-credentials' }),
          b('pod_vol_pvc', { NAME: 'data', CLAIM: 'demo-app-data' }),
          b('pod_container', { NAME: 'demo-app', IMAGE: 'image-registry.openshift-image-registry.svc:5000/demo-project/demo-app:latest' }, [
            b('c_port', { PORT: 8080, NAME: '', PROTO: 'TCP' }),
            b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' }),
            b('c_resources', { KIND: 'limits', CPU: '500m', MEM: '512Mi' }),
            b('c_env_from', { SRC: 'configMapRef', NAME: 'demo-app-config' }),
            b('c_env_from', { SRC: 'secretRef', NAME: 'demo-app-secret' }),
            b('c_mount', { NAME: 'data', PATH: '/data', RO: false }),
            b('c_probe', { KIND: 'readinessProbe', HOW: 'http', PATH: '/healthz', PORT: '8080', DELAY: 5, PERIOD: 10 }),
          ]),
        ]),
      ),
      file(
        '05-service.yaml',
        'k8s',
        stack(b('k8s_service', { NAME: 'demo-app', APP: 'demo-app', TYPE: 'ClusterIP' }), [b('svc_k8s_port', { PORT: 80, TARGET: '8080', NAME: 'http', PROTO: 'TCP' })]),
      ),
      file(
        '06-route.yaml',
        'k8s',
        stack(b('k8s_route', { NAME: 'demo-app', SVC: 'demo-app', PORT: 'http' }), [b('route_tls', { TERM: 'edge', INSEC: 'Redirect' })]),
      ),
      file(
        '07-secret.yaml',
        'k8s',
        stack(b('k8s_secret', { NAME: 'demo-app-secret', TYPE: 'Opaque' }), [
          b('data_entry', { K: 'DB_USERNAME', V: 'demo_user' }),
          b('data_entry', { K: 'DB_PASSWORD', V: 'replace-me' }),
          b('data_entry', { K: 'API_KEY', V: 'replace-me' }),
        ]),
      ),
      file(
        '08-configmap.yaml',
        'k8s',
        stack(b('k8s_configmap', { NAME: 'demo-app-config' }), [
          b('data_entry', { K: 'APP_ENV', V: 'production' }),
          b('data_entry', { K: 'LOG_LEVEL', V: 'info' }),
          b('data_entry', { K: 'DATABASE_HOST', V: 'postgres' }),
          b('data_entry', { K: 'DATABASE_PORT', V: '5432' }),
        ]),
      ),
      file(
        '10-registry-secret.yaml',
        'k8s',
        stack(b('k8s_secret', { NAME: 'registry-credentials', TYPE: 'kubernetes.io/dockerconfigjson' }), [
          b('data_registry', { SERVER: 'registry.example.com', USER: 'myuser', PASS: 'replace-me' }),
        ]),
      ),
      file('11-pvc.yaml', 'k8s', stack(b('k8s_pvc', { NAME: 'demo-app-data', SIZE: '5Gi', MODE: 'ReadWriteOnce' }), [])),
      file(
        '12-hpa.yaml',
        'k8s',
        stack(b('k8s_hpa', { NAME: 'demo-app-hpa', TARGET: 'demo-app', MIN: 2, MAX: 5 }), [b('hpa_metric', { RES: 'cpu', PCT: 70 })]),
      ),
    ],
  };
}

export function composeDemo(): Project {
  return {
    format: 'byobyaml',
    version: 2,
    id: uid(),
    title: 'Compose: Web + Postgres + Redis',
    envs: ['dev', 'prod'],
    activeEnv: 'dev',
    variables: [
      { name: 'DB_PASSWORD', values: { dev: 'shop', prod: 'change-me' } },
      { name: 'WEB_PORT', values: { dev: '8080', prod: '80' } },
    ],
    files: [
      file(
        'docker-compose.yml',
        'compose',
        stack(b('compose_file', { NAME: 'shop' }), [
          b('compose_service', { NAME: 'web', IMAGE: '' }, [
            b('svc_build', { CTX: '.', FILE: 'Dockerfile' }),
            b('svc_port', { HOST: '${WEB_PORT}', CONT: '3000', PROTO: 'tcp' }),
            b('svc_env', { K: 'DATABASE_URL', V: 'postgres://shop:${DB_PASSWORD}@db:5432/shop' }),
            b('svc_env', { K: 'REDIS_URL', V: 'redis://cache:6379' }),
            b('svc_depends', { NAME: 'db', COND: 'service_healthy' }),
            b('svc_depends', { NAME: 'cache', COND: 'service_started' }),
            b('svc_restart', { R: 'unless-stopped' }),
          ]),
          b('compose_service', { NAME: 'db', IMAGE: 'postgres:16-alpine' }, [
            b('svc_env', { K: 'POSTGRES_USER', V: 'shop' }),
            b('svc_env', { K: 'POSTGRES_PASSWORD', V: '${DB_PASSWORD}' }),
            b('svc_env', { K: 'POSTGRES_DB', V: 'shop' }),
            b('svc_volume', { SRC: 'pgdata', DST: '/var/lib/postgresql/data', RO: false }),
            b('svc_healthcheck', { CMD: 'pg_isready -U shop', INT: '10s', TO: '5s', RET: 5 }),
            b('svc_restart', { R: 'unless-stopped' }),
          ]),
          b('compose_service', { NAME: 'cache', IMAGE: 'redis:7-alpine' }, [b('svc_restart', { R: 'unless-stopped' })]),
          b('compose_volume', { NAME: 'pgdata', DRIVER: '__none__' }),
        ]),
      ),
    ],
  };
}
