const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  isElectron: true,
  loadAutoSave: () => ipcRenderer.invoke('project:load-autosave'),
  saveAutoSave: (project) => ipcRenderer.invoke('project:save-autosave', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProjectAs: (project) => ipcRenderer.invoke('project:save-as', project),
  exportCsv: (payload) => ipcRenderer.invoke('project:export-csv', payload),
  listSources: () => ipcRenderer.invoke('sources:list'),
  selectFiles: () => ipcRenderer.invoke('files:select'),
  selectReferenceFiles: () => ipcRenderer.invoke('files:select-reference'),
  getAiCapabilities: () => ipcRenderer.invoke('ai:capabilities'),
  analyzeFiles: (request) => ipcRenderer.invoke('ai:analyze-files', request)
}));
