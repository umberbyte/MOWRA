const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const appRoot = path.join(__dirname, '..');

function autoSavePath() {
  return path.join(app.getPath('userData'), 'current-project.json');
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f4f6f2',
    show: false,
    title: 'ScopeCraft — テスト観点設計',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.removeMenu();
  window.loadFile(path.join(appRoot, 'dist', 'index.html'));
  window.once('ready-to-show', () => window.show());
}

ipcMain.handle('project:load-autosave', () => readJson(autoSavePath()));
ipcMain.handle('project:save-autosave', (_event, project) => writeJsonAtomic(autoSavePath(), project));

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'ScopeCraft案件を開く',
    properties: ['openFile'],
    filters: [{ name: 'ScopeCraft案件', extensions: ['scopecraft', 'json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { project: await readJson(result.filePaths[0]), filePath: result.filePaths[0] };
});

ipcMain.handle('project:save-as', async (_event, project) => {
  const safeName = String(project.projectName || 'test-project').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog({
    title: 'ScopeCraft案件を保存',
    defaultPath: `${safeName}.scopecraft`,
    filters: [{ name: 'ScopeCraft案件', extensions: ['scopecraft'] }]
  });
  if (result.canceled || !result.filePath) return null;
  await writeJsonAtomic(result.filePath, project);
  return result.filePath;
});

ipcMain.handle('project:export-csv', async (_event, payload) => {
  const safeName = String(payload.projectName || 'test-viewpoints').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog({
    title: 'テスト観点表をCSVで出力',
    defaultPath: `${safeName}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, payload.csv, 'utf8');
  return result.filePath;
});

app.whenReady().then(() => {
  app.setAppUserModelId('jp.scopecraft.desktop');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
