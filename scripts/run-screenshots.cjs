// Launches the built app with a fresh, temporary data directory and runs scripts/screenshots.cjs.
// Usage: bun run docs:screens   (builds the renderer first)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'byob-screens-'));
const electron = require(path.join(root, 'node_modules', 'electron'));

const r = spawnSync(electron, ['.', '--force-device-scale-factor=1.5'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BYOB_USER_DATA: data, BYOB_AUTOMATION: path.join(__dirname, 'screenshots.cjs'), VITE_DEV_SERVER_URL: '' },
});
fs.rmSync(data, { recursive: true, force: true });
process.exit(r.status ?? 1);
