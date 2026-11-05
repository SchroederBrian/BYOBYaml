// Rebuild the pinned, offline validators used by the custom block designer.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const Ajv = require('ajv').default;
const Ajv2020 = require('ajv/dist/2020').default;
const standalone = require('ajv/dist/standalone').default;
const output = resolve('src/custom-blocks/generated');
mkdirSync(output, { recursive: true });
const get = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Schema download failed: ${response.status} ${url}`); return response.text(); };
const composeCommit = JSON.parse(await get('https://api.github.com/repos/compose-spec/compose-spec/commits?path=schema/compose-spec.json&per_page=1'))[0].sha;
const kubernetesVersion = 'v1.37.2';
const urls = { compose: `https://raw.githubusercontent.com/compose-spec/compose-spec/${composeCommit}/schema/compose-spec.json`, kubernetes: `https://raw.githubusercontent.com/kubernetes/kubernetes/${kubernetesVersion}/api/openapi-spec/swagger.json` };
const sources = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([name, url]) => [name, await get(url)])));
const compose = JSON.parse(sources.compose), kube = JSON.parse(sources.kubernetes);
const options = { strict: false, allErrors: true, validateFormats: false, inlineRefs: false, code: { source: true, esm: true, optimize: true } };
const composeAjv = new Ajv2020(options);
writeFileSync(resolve(output, 'compose.raw.js'), standalone(composeAjv, composeAjv.compile(compose)));
const wanted = new Set(['Deployment','StatefulSet','DaemonSet','ReplicaSet','Pod','Job','CronJob','Service','Ingress','ConfigMap','Secret','PersistentVolumeClaim','Namespace','ServiceAccount','HorizontalPodAutoscaler']);
const roots = Object.entries(kube.definitions).filter(([, schema]) => (schema['x-kubernetes-group-version-kind'] ?? []).some((gvk) => wanted.has(gvk.kind) && gvk.version === 'v1' || gvk.kind === 'HorizontalPodAutoscaler' && gvk.version === 'v2'));
const needed = new Set();
function gather(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref?.startsWith('#/definitions/')) {
    const key = value.$ref.slice(14);
    if (!needed.has(key)) { needed.add(key); gather(kube.definitions[key]); }
  }
  for (const child of Object.values(value)) if (typeof child === 'object') gather(child);
}
for (const [key, schema] of roots) { needed.add(key); gather(schema); }
function normalize(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const result = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description' && key !== 'externalDocs').map(([key, child]) => [key, normalize(child)]));
  if (result.format === 'int-or-string' || result['x-kubernetes-int-or-string']) { delete result.type; delete result.format; result.anyOf = [{ type: 'integer' }, { type: 'string' }]; }
  if (result.properties && result.additionalProperties === undefined && !result['x-kubernetes-preserve-unknown-fields']) result.additionalProperties = false;
  if (result.nullable && result.type) result.type = [result.type, 'null'];
  return result;
}
const schemaId = 'https://byobyaml.keksgames.de/schemas/kubernetes-custom-blocks.json';
const subset = { $id: schemaId, definitions: Object.fromEntries([...needed].map((key) => [key, normalize(kube.definitions[key])])) };
const kubeAjv = new Ajv(options);
kubeAjv.addSchema(subset);
const exports = {}, resourceMap = {};
for (const [index, [key, schema]] of roots.entries()) {
  const symbol = `resource${index}`;
  exports[symbol] = `${schemaId}#/definitions/${key}`;
  for (const gvk of schema['x-kubernetes-group-version-kind'] ?? []) resourceMap[`${gvk.group ? gvk.group + '/' : ''}${gvk.version}:${gvk.kind}`] = symbol;
}
writeFileSync(resolve(output, 'kubernetes.raw.js'), standalone(kubeAjv, exports));
for (const name of ['compose','kubernetes']) {
  execFileSync(process.env.BUN_EXE || 'C:/Users/bobby/.bun/bin/bun.exe', ['build', resolve(output, `${name}.raw.js`), '--target=browser', '--format=esm', '--minify', `--outfile=${resolve(output, `${name}.js`)}`], { stdio: 'inherit' });
  writeFileSync(resolve(output, `${name}.d.ts`), name === 'compose' ? 'declare const validate: { (value: unknown): boolean; errors?: any[] | null }; export default validate;\n' : Object.values(exports).map((_, index) => `export const resource${index}: { (value: unknown): boolean; errors?: any[] | null };`).join('\n') + '\n');
}
writeFileSync(resolve(output, 'resources.json'), JSON.stringify(resourceMap, null, 2) + '\n');
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify({ kubernetesVersion, composeCommit, generatedAt: new Date().toISOString(), sources: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, { url: urls[key], sha256: createHash('sha256').update(value).digest('hex') }])), strictObjects: true, ajvVersion: require('ajv/package.json').version }, null, 2) + '\n');
writeFileSync(resolve(output, 'LICENSES.md'), '# Validator sources\n\nGenerated from the official Compose Specification and Kubernetes OpenAPI schemas. Source URLs, versions and SHA-256 digests are recorded in provenance.json.\n\nCompose Specification and Kubernetes: Apache-2.0. Validator runtime: Ajv (MIT).\n\n' + readFileSync(require.resolve('ajv/LICENSE'), 'utf8'));
console.log(`Generated offline validators for ${roots.length} Kubernetes resource schemas and Compose.`);
