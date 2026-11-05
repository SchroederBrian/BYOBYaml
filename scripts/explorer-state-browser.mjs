// Run against a dev server; Playwright is an optional external tool.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/explorer-state-browser.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(10000);
const fixture = (id) => ({
  format: 'byobyaml', version: 2, id, title: id,
  envs: ['dev'], activeEnv: 'dev', variables: [],
  folders: ['services/api', 'services/worker', 'configs', 'empty'],
  files: [
    { id: `${id}-api`, name: 'api.yaml', folder: 'services/api', kind: 'k8s', state: {} },
    { id: `${id}-worker`, name: 'worker.yaml', folder: 'services/worker', kind: 'k8s', state: {} },
  ],
});
await page.addInitScript((projects) => {
  if (localStorage.getItem('explorer-fixture-seeded')) return;
  localStorage.setItem('byobyaml.v2.projects', JSON.stringify(Object.fromEntries(projects.map((p) => [p.id, { p, updatedAt: Date.now() }]))));
  localStorage.setItem('byobyaml.v2.settings', JSON.stringify({ lastProjectId: projects[0].id }));
  localStorage.setItem('explorer-fixture-seeded', 'true');
}, [fixture('explorer-a'), fixture('explorer-b')]);

const folder = (path) => page.locator('.folder-row').filter({ has: page.locator(`.fname[title="${path}"]`) });
const expanded = async (path, expected) => {
  assert.equal(await folder(path).getAttribute('aria-expanded'), String(expected), `${path} expanded=${expected}`);
};
const ready = () => folder('services').waitFor();
const switchProject = async (id) => {
  await page.evaluate((id) => localStorage.setItem('byobyaml.v2.settings', JSON.stringify({ lastProjectId: id })), id);
  await page.reload();
  await ready();
};

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5187');
  await ready();
  await expanded('services/api', true);
  await folder('services/api').click();
  await folder('services/worker').click();
  await folder('services').click();
  await folder('configs').click();
  await page.reload();
  await ready();
  await expanded('services', false); // Includes the initially active file.
  await expanded('configs', false);
  await expanded('empty', true);

  await folder('services').click();
  await expanded('services/api', false);
  await expanded('services/worker', false); // Hidden children keep their own state.
  await page.reload();
  await ready();
  await expanded('services', true);
  await expanded('services/api', false);
  await expanded('services/worker', false);

  await folder('services/api').click();
  await page.reload();
  await ready();
  await expanded('services/api', true); // Reopening must overwrite the saved state.
  await expanded('services/worker', false);

  // Changing the active file must not lose other folders' state.
  await folder('services/worker').click();
  await page.locator('.file-list .fname[title="services/worker/worker.yaml"]').click();
  await folder('services/api').click();
  await folder('services').click();

  await switchProject('explorer-b');
  await expanded('services', true);
  await expanded('services/api', true);
  await expanded('configs', true);
  await folder('empty').click();
  await switchProject('explorer-a');
  await expanded('services', false);
  await expanded('configs', false);
  await expanded('empty', true);

  await folder('services').click();
  await expanded('services/api', false);
  await folder('services').getByTitle('Umbenennen', { exact: true }).click();
  await folder('services').locator('input').fill('renamed');
  await folder('services').locator('input').press('Enter');
  await expanded('renamed/api', false);
  // Folder structure uses the existing project autosave.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('byobyaml.v2.projects'))['explorer-a'].p.folders.includes('renamed/api'));
  await page.reload();
  await folder('renamed').waitFor();
  await expanded('renamed/api', false);
  assert.deepEqual(errors, []);
  console.log('PASS: expanded/collapsed folders, hidden children, active-file reload, project isolation, and rename survive reload.');
} finally {
  await browser.close();
}
