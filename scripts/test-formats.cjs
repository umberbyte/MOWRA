const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { zipSync, strToU8 } = require('fflate');
const { serializeProject, deserializeProject } = require('../electron/project-format.cjs');
const { sourceAdapters } = require('../electron/source-adapters.cjs');
const { buildPrompt, compactText, CUSTOMER_PROMPT_BUDGET, REFERENCE_PROMPT_BUDGET, MAX_VIEWPOINTS } = require('../electron/analysis-service.cjs');
const { generateTestCases, buildTestCasePrompt, normalizeTestCaseResult, FAST_BATCH_SIZE } = require('../electron/test-case-service.cjs');

function writeMinimalPdf(filePath) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 52 >>\nstream\nBT /F1 12 Tf 72 720 Td (MOWRA PDF Requirement) Tj ET\nendstream'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(filePath, pdf, 'binary');
}

function writeMinimalPptx(filePath) {
  const xml = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP"/><a:t>MOWRA PPTX Requirement</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  };
  fs.writeFileSync(filePath, Buffer.from(zipSync(Object.fromEntries(Object.entries(xml).map(([name, value]) => [name, strToU8(value)])))));
}

async function run() {
  const sample = {
    projectName: '案件 & <確認>', targetUrl: 'https://example.jp/?a=1&b=2', mode: 'ambiguous', activeStage: 'cases',
    focus: 'general', filter: 'review', aiProvider: 'codex', context: '顧客の説明\n2行目',
    sources: ['現行画面', 'UX指針'],
    inputFiles: [{ id: 'f1', name: '仕様.xlsx', path: 'C:\\案件\\仕様.xlsx', extension: '.xlsx', size: 123, modifiedAt: 1000, sourceType: 'local-file' }],
    referenceFiles: [{ id: 'r1', name: '社内観点集.pdf', path: 'C:\\標準\\社内観点集.pdf', extension: '.pdf', size: 456, modifiedAt: 2000, sourceType: 'local-file' }],
    items: [{ id: 'VP-001', target: '画面', title: '操作 & 応答', description: '期待どおり', basis: 'UX指針', priority: '高', state: 'review', question: '確認？' }],
    testCases: [{ id: 'TC-001', viewpointId: 'VP-001', title: '正常に操作できる', type: '正常系', priority: '高', state: 'draft', preconditions: 'ログイン済み', testData: '有効な値', steps: [{ actionTarget: '送信ボタン', actionLocator: "getByRole('button', { name: '送信', exact: true })", action: 'ボタンを押す', expectedTarget: '完了メッセージ', expectedLocator: "getByRole('status', { name: '送信完了', exact: true })", expected: '完了が表示される' }] }],
    analysisSummary: '要約', analysisStatus: '分析完了', analysisInputSignature: 'signature-1', analysisQuestions: ['質問1', '質問2'], testCaseSummary: 'ケース要約', caseGenerationStatus: '生成完了'
  };
  const xml = serializeProject(sample);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<testprj version="1\.0">/);
  assert.deepEqual(deserializeProject(xml), sample);
  const prompt = buildPrompt({
    customerDocuments: [{ name: '顧客仕様.html', content: '案件固有要件' }],
    referenceDocuments: [{ name: '社内観点集.pdf', content: '再利用する観点' }],
    project: sample
  });
  assert.match(prompt, /<customer-document[^>]+顧客仕様\.html[^>]*>[\s\S]*案件固有要件/);
  assert.match(prompt, /<company-reference[^>]+社内観点集\.pdf[^>]*>[\s\S]*再利用する観点/);
  assert.match(prompt, /標準観点集等の自社ドキュメント/);
  assert.match(prompt, /当該案件の仕様や合意事項とはみなさない/);
  assert.ok(compactText('a'.repeat(10_000), 1_000).length <= 1_000);
  assert.ok(compactText('a'.repeat(10_000), 1_000).length > 900);
  const largePrompt = buildPrompt({
    customerDocuments: [{ name: 'large.txt', content: '顧客要件\n'.repeat(100_000) }],
    referenceDocuments: [{ name: 'reference.txt', content: '標準観点\n'.repeat(100_000) }],
    existingViewpoints: [{ target: 'ログイン', title: 'ログインできる' }],
    project: sample
  });
  assert.ok(largePrompt.length < CUSTOMER_PROMPT_BUDGET + REFERENCE_PROMPT_BUDGET + 10_000);
  assert.match(largePrompt, /ログインできる/);
  assert.equal(MAX_VIEWPOINTS, 12);
  const agreedViewpoint = { ...sample.items[0], state: 'agreed' };
  const casePrompt = buildTestCasePrompt({ viewpoints: [agreedViewpoint], project: sample });
  assert.match(casePrompt, /合意済み観点/);
  assert.match(casePrompt, /\["VP-001","画面","操作 & 応答"/);
  assert.match(casePrompt, /getByRole/);
  assert.match(casePrompt, /DOM上で1件/);
  assert.deepEqual(normalizeTestCaseResult({ summary: '設計完了', testCases: [{
    viewpointId: 'VP-001', title: '有効な値で完了できる', type: '正常系', priority: '高',
    preconditions: 'ログイン済み', testData: '有効な値', state: 'draft',
    steps: [{ actionTarget: '氏名入力欄', actionLocator: "getByLabel('氏名', { exact: true })", action: '値を入力する', expectedTarget: '氏名入力欄', expectedLocator: "getByLabel('氏名', { exact: true })", expected: '値が入力欄に表示される' }]
  }] }, [agreedViewpoint]), {
    summary: '設計完了',
    testCases: [{ viewpointId: 'VP-001', title: '有効な値で完了できる', type: '正常系', priority: '高', preconditions: 'ログイン済み', testData: '有効な値', state: 'draft', steps: [{ actionTarget: '氏名入力欄', actionLocator: "getByLabel('氏名', { exact: true })", action: '値を入力する', expectedTarget: '氏名入力欄', expectedLocator: "getByLabel('氏名', { exact: true })", expected: '値が入力欄に表示される' }] }]
  });
  const ambiguousLocator = normalizeTestCaseResult({ summary: '', testCases: [{
    viewpointId: 'VP-001', title: '曖昧な対象を確認する', type: '探索的', priority: '中',
    preconditions: '画面表示済み', testData: 'なし', state: 'draft',
    steps: [{ actionTarget: 'ボタン', actionLocator: 'button', action: '押す', expectedTarget: 'メッセージ', expectedLocator: 'text=完了', expected: '完了する' }]
  }] }, [agreedViewpoint]);
  assert.equal(ambiguousLocator.testCases[0].state, 'review');
  assert.match(ambiguousLocator.testCases[0].steps[0].actionLocator, /^要確認:/);
  const manyViewpoints = Array.from({ length: 20 }, (_, index) => ({ ...agreedViewpoint, id: `VP-${String(index + 1).padStart(3, '0')}` }));
  let batchCalls = 0;
  const batched = await generateTestCases({ provider: 'codex', confirmedExternalTransmission: true, viewpoints: manyViewpoints, project: sample }, {}, async (_provider, _prompt, _runtime, batch) => {
    batchCalls++;
    assert.ok(batch.length <= FAST_BATCH_SIZE);
    return { summary: `batch ${batchCalls}`, testCases: batch.map((viewpoint) => ({ viewpointId: viewpoint.id, title: `${viewpoint.id}のケース`, type: '正常系', priority: '高', preconditions: '前提', testData: 'データ', state: 'draft', steps: [{ actionTarget: '対象', actionLocator: "getByTestId('target')", action: '操作', expectedTarget: '結果', expectedLocator: "getByTestId('result')", expected: '結果' }] })) };
  });
  assert.equal(batchCalls, 2);
  assert.equal(batched.testCases.length, 20);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mowra-formats-'));
  try {
    fs.writeFileSync(path.join(directory, 'sample.html'), '<h1>Visible heading</h1><script>SECRET_SCRIPT</script><p>Visible body</p>');
    fs.writeFileSync(path.join(directory, 'sample.csv'), 'feature,expected\nsearch,results');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['feature', 'expected'], ['login', 'dashboard']]), 'Requirements');
    XLSX.writeFile(workbook, path.join(directory, 'sample.xlsx'));
    XLSX.writeFile(workbook, path.join(directory, 'sample.xls'), { bookType: 'biff8' });
    writeMinimalPdf(path.join(directory, 'sample.pdf'));
    writeMinimalPptx(path.join(directory, 'sample.pptx'));

    const paths = ['sample.html', 'sample.csv', 'sample.xlsx', 'sample.xls', 'sample.pdf', 'sample.pptx'].map((name) => path.join(directory, name));
    const described = await sourceAdapters.local.describe(paths);
    const documents = await sourceAdapters.local.load(described);
    const byExtension = Object.fromEntries(documents.map((document) => [document.extension, document.content]));
    assert.match(byExtension['.html'], /Visible heading/);
    assert.doesNotMatch(byExtension['.html'], /SECRET_SCRIPT/);
    assert.match(byExtension['.csv'], /search,results/);
    assert.match(byExtension['.xlsx'], /シート: Requirements[\s\S]*login,dashboard/);
    assert.match(byExtension['.xls'], /シート: Requirements[\s\S]*login,dashboard/);
    assert.match(byExtension['.pdf'], /MOWRA PDF Requirement/);
    assert.match(byExtension['.pptx'], /MOWRA PPTX Requirement/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('Project XML and supported document extraction tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
