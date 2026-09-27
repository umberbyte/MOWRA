const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { sourceAdapters, ALLOWED_EXTENSIONS } = require('./source-adapters.cjs');
const { resolveCliCommand } = require('./cli-resolver.cjs');
const { analyzeDocuments } = require('./analysis-service.cjs');
const { generateTestCases } = require('./test-case-service.cjs');
const { executeAutomation } = require('./automation-service.cjs');
const { serializeProject, deserializeProject } = require('./project-format.cjs');

const appRoot = path.join(__dirname, '..');

function autoSavePath() {
  return path.join(app.getPath('userData'), 'current-project.testprj');
}

async function writeTextAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, value, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function readProject(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return path.extname(filePath).toLowerCase() === '.testprj' ? deserializeProject(raw) : JSON.parse(raw);
}

async function loadAutoSave() {
  const candidates = [
    autoSavePath(),
    path.join(app.getPath('userData'), 'current-project.json'),
    path.join(app.getPath('appData'), 'scopecraft-desktop', 'current-project.testprj'),
    path.join(app.getPath('appData'), 'scopecraft-desktop', 'current-project.json')
  ];
  for (const candidate of candidates) {
    try {
      return await readProject(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function saveProjectFile(filePath, project) {
  await writeTextAtomic(filePath, serializeProject(project));
}

function createWindow({ smokeTest = false } = {}) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    icon: path.join(appRoot, 'mowra-app-icons', 'png', 'icon_1024x1024.png'),
    backgroundColor: '#f4f6f2',
    show: false,
    title: 'MOWRA — AIテスト設計・自動化',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.removeMenu();
  window.loadFile(path.join(appRoot, 'dist', 'index.html'));
  window.once('ready-to-show', () => {
    if (!smokeTest) window.show();
  });
  if (smokeTest) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(() => resolve({
          bridge: Boolean(window.desktopBridge && window.desktopBridge.isElectron),
          filePicker: typeof window.desktopBridge?.selectFiles === 'function',
          referencePicker: typeof window.desktopBridge?.selectReferenceFiles === 'function',
          analyzer: typeof window.desktopBridge?.analyzeFiles === 'function',
          caseGenerator: typeof window.desktopBridge?.generateTestCases === 'function',
          automationRunner: typeof window.desktopBridge?.executeAutomation === 'function',
          caseWorkspace: Boolean(document.querySelector('#caseWorkspace')),
          caseGenerateButton: Boolean(document.querySelector('#generateCasesBtn')),
          automationWorkspace: Boolean(document.querySelector('#automationWorkspace')),
          title: document.title,
          providerStatus: document.querySelector('#providerStatus')?.textContent || ''
        }), 400))`);
        console.log(`SMOKE_TEST ${JSON.stringify(result)}`);
        app.exit(result.bridge && result.filePicker && result.referencePicker && result.analyzer && result.caseGenerator && result.automationRunner && result.caseWorkspace && result.caseGenerateButton && result.automationWorkspace && result.title.startsWith('MOWRA') ? 0 : 1);
      } catch (error) {
        console.error('SMOKE_TEST_FAILED', error);
        app.exit(1);
      }
    });
  }
}

ipcMain.handle('project:load-autosave', () => loadAutoSave());
ipcMain.handle('project:save-autosave', (_event, project) => saveProjectFile(autoSavePath(), project));

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'MOWRA案件を開く',
    properties: ['openFile'],
    filters: [
      { name: 'MOWRA案件', extensions: ['testprj'] },
      { name: '旧形式の案件', extensions: ['scopecraft', 'json'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { project: await readProject(result.filePaths[0]), filePath: result.filePaths[0] };
});

ipcMain.handle('project:save-as', async (_event, project) => {
  const safeName = String(project.projectName || 'test-project').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog({
    title: 'MOWRA案件を保存',
    defaultPath: `${safeName}.testprj`,
    filters: [{ name: 'MOWRA案件（XML）', extensions: ['testprj'] }]
  });
  if (result.canceled || !result.filePath) return null;
  await saveProjectFile(result.filePath, project);
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

ipcMain.handle('project:export-test-cases-csv', async (_event, payload) => {
  const safeName = String(payload.projectName || 'test-cases').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog({
    title: 'テストケース表をCSVで出力',
    defaultPath: `${safeName}-test-cases.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, payload.csv, 'utf8');
  return result.filePath;
});

ipcMain.handle('sources:list', () => Object.values(sourceAdapters).map(({ id, label, available, reason }) => ({ id, label, available, reason })));

async function selectDocumentFiles({ title, filterName }) {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: filterName, extensions: [...ALLOWED_EXTENSIONS].map((value) => value.slice(1)) },
      { name: 'すべてのファイル', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  return sourceAdapters.local.describe(result.filePaths);
}

ipcMain.handle('files:select', () => selectDocumentFiles({
  title: '分析する顧客資料を選択', filterName: '対応する顧客資料'
}));

ipcMain.handle('files:select-reference', () => selectDocumentFiles({
  title: '標準観点集等の自社ドキュメントを選択', filterName: '対応する自社ドキュメント'
}));

ipcMain.handle('automation:select-bruno-collection', async () => {
  const result = await dialog.showOpenDialog({ title: 'Brunoコレクションを選択', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('ai:capabilities', async () => ({
  codex: Boolean(await resolveCliCommand('codex')),
  claude: Boolean(await resolveCliCommand('claude'))
}));

ipcMain.handle('ai:analyze-files', async (_event, request) => analyzeDocuments(request, {
  userDataPath: app.getPath('userData'),
  schemaPath: path.join(__dirname, 'analysis-schema.json'),
  reasoningEffort: 'low',
  codexCommand: await resolveCliCommand('codex'),
  claudeCommand: await resolveCliCommand('claude')
}));

ipcMain.handle('ai:generate-test-cases', async (_event, request) => generateTestCases(request, {
  userDataPath: app.getPath('userData'),
  schemaPath: path.join(__dirname, 'test-case-schema.json'),
  reasoningEffort: 'low',
  codexCommand: await resolveCliCommand('codex'),
  claudeCommand: await resolveCliCommand('claude')
}));

ipcMain.handle('automation:execute', async (_event, request) => executeAutomation(request, {
  userDataPath: app.getPath('userData')
}));

app.whenReady().then(() => {
  app.setAppUserModelId('jp.mowra.desktop');
  const smokeTest = process.argv.includes('--smoke-test');
  createWindow({ smokeTest });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !smokeTest) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
