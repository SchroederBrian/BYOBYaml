// Run against an existing dev server. Playwright stays an optional external tool:
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/variable-scopes-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const screenshotPath = process.env.SCREENSHOT_PATH || '/tmp/byobyaml-variable-scopes/scopes.png';
await mkdir(dirname(screenshotPath), { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
const makeFile = (id, replicas, variables = []) => ({
  id, name: `${id}.yaml`, kind: 'k8s', variables,
  state: { blocks: { languageVersion: 0, blocks: [{ type: 'k8s_deployment', fields: { NAME: '${APP}', REPLICAS: replicas }, x: 40, y: 40 }] } },
});
const fixture = {
  format: 'byobyaml', version: 2, id: 'scope-browser-test', title: 'Variable scopes QA',
  envs: ['dev', 'prod'], activeEnv: 'dev',
  variables: [{ name: 'APP', values: { dev: 'shared-dev', prod: 'shared-prod' } }],
  files: [
    makeFile('one', 1, [{ name: 'APP', values: { dev: 'local-dev', prod: 'local-prod' } }, { name: 'PRIVATE', values: { dev: 'only-one', prod: 'only-one-prod' } }]),
    makeFile('two', 2),
    makeFile('three', 3, [{ name: 'THIRD', values: { dev: 'third-dev', prod: 'third-prod' } }]),
  ],
};
await page.addInitScript((fixture) => {
  if (!localStorage.getItem('scope-fixture-seeded')) {
    localStorage.setItem('byobyaml.v2.projects', JSON.stringify({ [fixture.id]: { p: fixture, updatedAt: Date.now() } }));
    localStorage.setItem('byobyaml.v2.settings', JSON.stringify({ lastProjectId: fixture.id }));
    localStorage.setItem('scope-fixture-seeded', 'true');
  }
  window.__exports = [];
  window.byob = { isElectron: false, exportFolder: async ({ files }) => { window.__exports.push(files); return 'test-export'; } };
}, fixture);
const yamlTab = () => page.getByRole('button', { name: 'YAML', exact: true }).click();
const varsTab = () => page.getByRole('button', { name: /^Variablen/ }).click();
const file = (name) => page.getByRole('treeitem').filter({ has: page.locator('.fname', { hasText: name }) });
const open = async (name) => { await file(name).click(); };
const value = (name, env, scope) => page.getByRole('textbox', { name: `${name} (${env}, ${scope})`, exact: true });
const expectYaml = async (name, replicas) => {
  await yamlTab();
  await page.waitForFunction(({ name, replicas }) => {
    const text = document.querySelector('.yaml-code')?.textContent ?? '';
    return text.includes(`name: ${name}`) && text.includes(`replicas: ${replicas}`);
  }, { name, replicas });
};
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('byobyaml.v2.projects'))['scope-browser-test'].p);
const settle = () => page.waitForTimeout(600);
let checks = 0;
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5179');
  await expectYaml('local-dev', 1);
  await open('two.yaml');
  await expectYaml('shared-dev', 2);
  await varsTab();
  assert.equal(await page.getByRole('table', { name: 'Nur diese Datei', exact: true }).count(), 0);
  checks++;

  // Switch repeatedly while generated results and workspace autosaves are pending.
  for (let i = 0; i < 4; i++) {
    await open('one.yaml'); await expectYaml('local-dev', 1);
    await open('three.yaml'); await expectYaml('shared-dev', 3);
    await open('two.yaml'); await expectYaml('shared-dev', 2);
  }
  await settle();
  assert.deepEqual((await stored()).files.map((f) => Number(f.state.blocks.blocks[0].fields.REPLICAS)), [1, 2, 3]);
  checks++;

  await varsTab();
  await value('APP', 'dev', 'Für alle Dateien').fill('shared-edited');
  await expectYaml('shared-edited', 2);
  await open('one.yaml');
  await expectYaml('local-dev', 1);
  await varsTab();
  await value('APP', 'dev', 'Nur diese Datei').fill('local-edited');
  await expectYaml('local-edited', 1);
  checks++;

  await page.locator('.env-select select').selectOption('prod');
  await expectYaml('local-prod', 1);
  await open('two.yaml'); await expectYaml('shared-prod', 2);
  await open('one.yaml'); await varsTab();
  await value('APP', 'prod', 'Nur diese Datei').fill('');
  await yamlTab();
  // Resource names have a generator fallback; labels still expose the empty value.
  await page.waitForFunction(() => {
    const text = document.querySelector('.yaml-code')?.textContent ?? '';
    return text.includes('name: unbenannt') && text.includes('app: ""') && !text.includes('shared-prod');
  });
  checks++;

  await varsTab();
  await value('APP', 'prod', 'Nur diese Datei').fill('local-prod-edited');
  await settle();
  await page.reload();
  await expectYaml('local-prod-edited', 1);
  await varsTab();
  assert.equal(await value('APP', 'dev', 'Nur diese Datei').inputValue(), 'local-edited');
  assert.equal(await value('APP', 'dev', 'Für alle Dateien').inputValue(), 'shared-edited');
  checks++;

  await file('one.yaml').hover();
  await file('one.yaml').getByTitle('Duplizieren', { exact: true }).click();
  await open('one-kopie.yaml');
  await varsTab();
  await value('APP', 'prod', 'Nur diese Datei').fill('copy-prod');
  await expectYaml('copy-prod', 1);
  await open('one.yaml'); await expectYaml('local-prod-edited', 1);
  checks++;

  await page.getByRole('button', { name: 'Exportieren', exact: true }).click();
  await page.getByRole('button', { name: /Alle Dateien in Ordner/ }).click();
  const exported = await page.evaluate(() => window.__exports.at(-1));
  assert.deepEqual(Object.fromEntries(exported.map((f) => [f.name, YAML.parse(f.content).metadata.name])), {
    'one.yaml': 'local-prod-edited', 'one-kopie.yaml': 'copy-prod', 'two.yaml': 'shared-prod', 'three.yaml': 'shared-prod',
  });
  checks++;

  await varsTab();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.getByRole('table', { name: 'Nur diese Datei', exact: true }).getByRole('row').filter({ has: value('APP', 'prod', 'Nur diese Datei') }).getByTitle('Löschen', { exact: true }).click();
  await expectYaml('shared-prod', 1);
  checks++;

  await varsTab();
  await page.getByTitle('prod entfernen', { exact: true }).click();
  await settle();
  const project = await stored();
  assert.deepEqual(project.envs, ['dev']);
  assert.equal(project.activeEnv, 'dev');
  for (const variable of [...project.variables, ...project.files.flatMap((f) => f.variables ?? [])]) assert.equal(Object.hasOwn(variable.values, 'prod'), false);
  await expectYaml('shared-edited', 1);
  await open('one-kopie.yaml'); await expectYaml('local-edited', 1);
  await page.reload(); await expectYaml('shared-edited', 1);
  checks++;

  await open('two.yaml'); await varsTab();
  await page.getByRole('button', { name: 'Variable anlegen: Für alle Dateien', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name (Für alle Dateien)', exact: true }).last().fill('NEW_GLOBAL');
  await value('NEW_GLOBAL', 'dev', 'Für alle Dateien').fill('global-created');
  await page.getByRole('button', { name: 'Variable anlegen: Nur diese Datei', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name (Nur diese Datei)', exact: true }).fill('NEW_LOCAL');
  await value('NEW_LOCAL', 'dev', 'Nur diese Datei').fill('local-created');
  await open('three.yaml');
  assert.equal(await value('NEW_LOCAL', 'dev', 'Nur diese Datei').count(), 0);
  assert.equal(await value('NEW_GLOBAL', 'dev', 'Für alle Dateien').inputValue(), 'global-created');
  await settle();
  await page.reload(); await open('two.yaml'); await varsTab();
  assert.equal(await value('NEW_LOCAL', 'dev', 'Nur diese Datei').inputValue(), 'local-created');
  checks++;

  assert.deepEqual(errors, []);
  console.log(`PASS: ${checks} browser scope scenarios; no uncaught browser errors.`);
} catch (error) {
  console.error(`Failed after ${checks} scenarios. Current YAML:`, await page.locator('.yaml-code').textContent().catch(() => '(not visible)'));
  await page.screenshot({ path: `${screenshotPath}.failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
