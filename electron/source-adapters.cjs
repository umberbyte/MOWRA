const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.log']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

async function describeLocalFiles(filePaths) {
  const results = [];
  let totalBytes = 0;
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    const extension = path.extname(absolutePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`${path.basename(absolutePath)} は現在対応していない形式です`);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new Error(`${path.basename(absolutePath)} はファイルではありません`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${path.basename(absolutePath)} は2MBを超えています`);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('選択したファイルの合計が6MBを超えています');
    results.push({
      id: crypto.createHash('sha256').update(absolutePath).digest('hex').slice(0, 16),
      name: path.basename(absolutePath),
      path: absolutePath,
      extension,
      size: stat.size,
      sourceType: 'local-file'
    });
  }
  return results;
}

async function loadLocalDocuments(files) {
  const verified = await describeLocalFiles(files.map((file) => file.path));
  return Promise.all(verified.map(async (file) => ({
    ...file,
    content: await fs.readFile(file.path, 'utf8')
  })));
}

const sourceAdapters = {
  local: {
    id: 'local',
    label: 'ローカルファイル',
    available: true,
    describe: describeLocalFiles,
    load: loadLocalDocuments
  },
  onedrive: {
    id: 'onedrive',
    label: 'Microsoft 365 / OneDrive',
    available: false,
    reason: 'Microsoft Graph接続は将来フェーズで有効化します'
  }
};

module.exports = { sourceAdapters, ALLOWED_EXTENSIONS };
