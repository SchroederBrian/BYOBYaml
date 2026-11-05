const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { openDb } = require('./db.cjs');

const devUrl = process.env.VITE_DEV_SERVER_URL;
let db;

// Dev-only: separate data dir and an automation script (used to capture doc screenshots).
if (!app.isPackaged && process.env.BYOB_USER_DATA) app.setPath('userData', process.env.BYOB_USER_DATA);
const automation = !app.isPackaged ? process.env.BYOB_AUTOMATION : undefined;

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    title: 'BYOBYaml',
    backgroundColor: '#0e1014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Block navigation away from the app (e.g. dropped files).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

// ---------- file dialogs ----------
ipcMain.handle('save-file', async (_e, { defaultName, content, filters }) => {
  const res = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, content, 'utf8');
  return res.filePath;
});

ipcMain.handle('open-files', async (_e, { filters, multi }) => {
  const res = await dialog.showOpenDialog({ properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters });
  if (res.canceled) return [];
  return Promise.all(res.filePaths.map(async (p) => ({ name: path.basename(p), content: await fs.readFile(p, 'utf8') })));
});

ipcMain.handle('export-folder', async (_e, { files }) => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = res.filePaths[0];
  for (const f of files) {
    // keep explorer folders as sub directories – but never leave the chosen directory
    const parts = String(f.name)
      .split(/[\\/]+/)
      .map((x) => x.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
      .filter((x) => x && x !== '.' && x !== '..');
    if (!parts.length) continue;
    const target = path.resolve(dir, ...parts);
    if (!target.startsWith(path.resolve(dir) + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, 'utf8');
  }
  return dir;
});

ipcMain.handle('reveal-data', () => shell.showItemInFolder(db.file));

// ---------- database ----------
const dbCall = (name) => ipcMain.handle(`db:${name}`, (_e, ...args) => db[name](...args));
['listProjects', 'getProject', 'saveProject', 'deleteProject', 'listSnippets', 'saveSnippet', 'deleteSnippet', 'getSetting', 'setSetting'].forEach(dbCall);
ipcMain.handle('db:info', () => ({ file: db.file }));

app.whenReady().then(() => {
  db = openDb(app.getPath('userData'));
  const win = createWindow();
  if (automation) require(path.resolve(automation))(win, app);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  db?.close();
  if (process.platform !== 'darwin') app.quit();
});
