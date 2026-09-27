const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  isElectron: true,
  loadAutoSave: () => ipcRenderer.invoke('project:load-autosave'),
  saveAutoSave: (project) => ipcRenderer.invoke('project:save-autosave', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProjectAs: (project) => ipcRenderer.invoke('project:save-as', project),
  exportCsv: (payload) => ipcRenderer.invoke('project:export-csv', payload)
}));
