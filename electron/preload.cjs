const { contextBridge, ipcRenderer } = require('electron');

const db = {};
for (const name of ['listProjects', 'getProject', 'saveProject', 'deleteProject', 'listSnippets', 'saveSnippet', 'deleteSnippet', 'getSetting', 'setSetting', 'info']) {
  db[name] = (...args) => ipcRenderer.invoke(`db:${name}`, ...args);
}

contextBridge.exposeInMainWorld('byob', {
  isElectron: true,
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  exportFolder: (opts) => ipcRenderer.invoke('export-folder', opts),
  revealData: () => ipcRenderer.invoke('reveal-data'),
  db,
});
