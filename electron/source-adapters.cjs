const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const officeParser = require('officeparser');
const XLSX = require('xlsx');
const PPT = require('ppt');
const CFB = require('cfb');

const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.log',
  '.ppt', '.pptx', '.xls', '.xlsx', '.pdf'
]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 750_000;

async function describeLocalFiles(filePaths) {
  const results = [];
  let totalBytes = 0;
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    const extension = path.extname(absolutePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`${path.basename(absolutePath)} は現在対応していない形式です`);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new Error(`${path.basename(absolutePath)} はファイルではありません`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${path.basename(absolutePath)} は15MBを超えています`);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('選択したファイルの合計が40MBを超えています');
    results.push({
      id: crypto.createHash('sha256').update(absolutePath).digest('hex').slice(0, 16),
      name: path.basename(absolutePath),
      path: absolutePath,
      extension,
      size: stat.size,
      modifiedAt: Math.trunc(stat.mtimeMs),
      sourceType: 'local-file'
    });
  }
  return results;
}

function truncateExtractedText(content, fileName) {
  const normalized = String(content || '').replaceAll('\u0000', '').trim();
  if (!normalized) throw new Error(`${fileName} から分析可能な文字を抽出できませんでした`);
  if (normalized.length <= MAX_EXTRACTED_CHARACTERS) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_CHARACTERS)}\n\n[MOWRA: 抽出結果が長いため、ここで省略しました]`;
}

function htmlToText(html) {
  const withoutHiddenContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ');
  return withoutHiddenContent
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n');
}

function spreadsheetToText(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  return workbook.SheetNames.map((sheetName) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
    return `## シート: ${sheetName}\n${csv}`;
  }).join('\n\n');
}

function legacyPowerPointToText(filePath) {
  // js-ppt expects the instance method used by older CFB releases. Adapt the
  // current CFB API locally so legacy .ppt support remains isolated.
  const compoundFile = CFB.read(filePath, { type: 'file' });
  compoundFile.find = (entryPath) => CFB.find(compoundFile, entryPath);
  const presentation = PPT.parse_pptcfb(compoundFile, {});
  return PPT.utils.to_text(presentation)
    .map((slideText, index) => `## スライド ${index + 1}\n${slideText}`)
    .join('\n\n');
}

async function officeDocumentToText(filePath, extension) {
  const ast = await officeParser.parseOffice(filePath, {
    fileType: extension.slice(1),
    extractAttachments: false,
    ocr: false
  });
  const output = await ast.to('text');
  return output.value;
}

async function extractDocumentText(file) {
  if (file.extension === '.xls' || file.extension === '.xlsx') return spreadsheetToText(file.path);
  if (file.extension === '.ppt') return legacyPowerPointToText(file.path);
  if (file.extension === '.pptx' || file.extension === '.pdf') return officeDocumentToText(file.path, file.extension);
  const content = await fs.readFile(file.path, 'utf8');
  return file.extension === '.html' || file.extension === '.htm' ? htmlToText(content) : content;
}

async function loadLocalDocuments(files) {
  const verified = await describeLocalFiles(files.map((file) => file.path));
  return Promise.all(verified.map(async (file) => {
    try {
      return { ...file, content: truncateExtractedText(await extractDocumentText(file), file.name) };
    } catch (error) {
      throw new Error(`${file.name} を読み取れませんでした: ${error.message}`);
    }
  }));
}

const sourceAdapters = {
  local: {
    id: 'local', label: 'ローカルファイル', available: true,
    describe: describeLocalFiles, load: loadLocalDocuments
  },
  onedrive: {
    id: 'onedrive', label: 'Microsoft 365 / OneDrive', available: false,
    reason: 'Microsoft Graph接続は将来フェーズで有効化します'
  }
};

module.exports = { sourceAdapters, ALLOWED_EXTENSIONS, MAX_FILE_BYTES, MAX_TOTAL_BYTES, extractDocumentText };
