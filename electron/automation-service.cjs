const path = require('node:path');
const { withStdioMcp, resultText } = require('./mcp-client.cjs');

function packageFile(packageName, relativePath) {
  return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), relativePath);
}

function serverEnvironment(extra = {}) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extra };
}

function parseQuoted(value) {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function locatorCode(locator) {
  let match = /^getByRole\('((?:\\'|[^'])+)'\s*,\s*\{\s*name:\s*'((?:\\'|[^'])+)'\s*,\s*exact:\s*true\s*\}\)$/.exec(locator);
  if (match) return `page.getByRole(${JSON.stringify(parseQuoted(match[1]))}, { name: ${JSON.stringify(parseQuoted(match[2]))}, exact: true })`;
  match = /^getByLabel\('((?:\\'|[^'])+)'\s*,\s*\{\s*exact:\s*true\s*\}\)$/.exec(locator);
  if (match) return `page.getByLabel(${JSON.stringify(parseQuoted(match[1]))}, { exact: true })`;
  match = /^getByTestId\('((?:\\'|[^'])+)'\)$/.exec(locator);
  if (match) return `page.getByTestId(${JSON.stringify(parseQuoted(match[1]))})`;
  match = /^locator\('(#(?:[A-Za-z][\w:.-]*))'\)$/.exec(locator);
  if (match) return `page.locator(${JSON.stringify(match[1])})`;
  throw new Error(`未対応または要確認のロケーターです: ${locator}`);
}

function inferOperation(step) {
  if (step.operation) return step.operation;
  if (/入力|記入|セット/.test(step.action || '')) return 'fill';
  if (/クリック|押す|選択/.test(step.action || '')) return 'click';
  if (/チェック/.test(step.action || '')) return 'check';
  return 'none';
}

function buildPlaywrightCode(testCase, targetUrl) {
  const lines = [
    'async (page) => {',
    `await page.goto(${JSON.stringify(targetUrl)}, { waitUntil: 'domcontentloaded' });`,
    'const evidence = [];'
  ];
  (testCase.steps || []).forEach((step, index) => {
    const action = locatorCode(step.actionLocator);
    const expected = locatorCode(step.expectedLocator);
    const operation = inferOperation(step);
    lines.push(`{ const actionTarget = ${action}; const actionCount = await actionTarget.count(); evidence.push({ step: ${index + 1}, kind: 'action', count: actionCount }); if (actionCount !== 1) throw new Error('手順${index + 1}の操作対象がDOM上で一意ではありません: ' + actionCount + '件');`);
    if (operation === 'click') lines.push('await actionTarget.click();');
    else if (operation === 'fill') lines.push(`await actionTarget.fill(${JSON.stringify(step.actionValue || testCase.testData || '')});`);
    else if (operation === 'check') lines.push('await actionTarget.check();');
    else if (operation === 'press') lines.push(`await actionTarget.press(${JSON.stringify(step.actionValue || 'Enter')});`);
    else if (operation === 'select') lines.push(`await actionTarget.selectOption(${JSON.stringify(step.actionValue || '')});`);
    lines.push(`const expectedTarget = ${expected}; const expectedCount = await expectedTarget.count(); evidence.push({ step: ${index + 1}, kind: 'expected', count: expectedCount }); if (expectedCount !== 1) throw new Error('手順${index + 1}の確認対象がDOM上で一意ではありません: ' + expectedCount + '件'); await expectedTarget.waitFor({ state: 'visible' });`);
    if (step.assertion === 'text' && step.expectedValue) lines.push(`if ((await expectedTarget.innerText()).trim() !== ${JSON.stringify(step.expectedValue)}) throw new Error('手順${index + 1}のテキストが期待値と一致しません');`);
    else if (step.assertion === 'value' && step.expectedValue) lines.push(`if (await expectedTarget.inputValue() !== ${JSON.stringify(step.expectedValue)}) throw new Error('手順${index + 1}の値が期待値と一致しません');`);
    lines.push('}');
  });
  lines.push("return { passed: true, evidence, url: page.url(), title: await page.title() };", '}');
  return lines.join('\n');
}

function summarizeToolResult(result) {
  const text = resultText(result);
  if (result?.isError) throw new Error(text || 'MCPツールが失敗しました');
  return result?.structuredContent || text;
}

async function executeWebCases(testCases, settings) {
  const targetUrl = String(settings.targetUrl || '');
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('Webテストにはhttp/httpsの対象URLが必要です');
  const server = {
    command: process.execPath,
    args: [packageFile('@playwright/mcp', 'cli.js'), '--headless', '--isolated', '--browser', settings.browser || 'msedge'],
    cwd: settings.runtimeDir,
    env: serverEnvironment()
  };
  return withStdioMcp(server, async (client) => {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === 'browser_run_code_unsafe')) throw new Error('Playwright MCPにbrowser_run_code_unsafeツールがありません');
    const results = [];
    for (const testCase of testCases) {
      const started = Date.now();
      try {
        const toolResult = await client.callTool({ name: 'browser_run_code_unsafe', arguments: { code: buildPlaywrightCode(testCase, targetUrl) } }, undefined, { timeout: 120_000 });
        results.push({ testCaseId: testCase.id, engine: 'playwright-mcp', status: 'passed', durationMs: Date.now() - started, summary: 'DOM一意性、操作、表示確認が完了しました', details: JSON.stringify(summarizeToolResult(toolResult)).slice(0, 8000), runAt: new Date().toISOString() });
      } catch (error) {
        results.push({ testCaseId: testCase.id, engine: 'playwright-mcp', status: 'failed', durationMs: Date.now() - started, summary: error.message.slice(0, 500), details: '', runAt: new Date().toISOString() });
      }
    }
    return results;
  });
}

async function executeApiCases(testCases, settings) {
  const collectionPath = path.resolve(String(settings.collectionPath || ''));
  const server = {
    command: process.execPath,
    args: [path.join(__dirname, 'bruno-mcp-server.mjs')],
    cwd: settings.runtimeDir,
    env: serverEnvironment({ MOWRA_BRU_CLI: packageFile('@usebruno/cli', 'bin/bru.js') })
  };
  return withStdioMcp(server, async (client) => {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === 'execute_request')) throw new Error('Bruno MCPにexecute_requestツールがありません');
    const results = [];
    for (const testCase of testCases) {
      const started = Date.now();
      try {
        if (!testCase.brunoRequestPath || /^要確認\s*[:：]/.test(testCase.brunoRequestPath)) throw new Error('Brunoリクエスト相対パスを設定してください');
        const toolResult = await client.callTool({ name: 'execute_request', arguments: { collectionPath, requestPath: testCase.brunoRequestPath, environment: settings.environment || undefined } }, undefined, { timeout: 120_000 });
        const output = summarizeToolResult(toolResult);
        results.push({ testCaseId: testCase.id, engine: 'bruno-mcp', status: 'passed', durationMs: Date.now() - started, summary: 'Brunoのリクエスト、アサーション、テストが完了しました', details: JSON.stringify(output).slice(0, 8000), runAt: new Date().toISOString() });
      } catch (error) {
        results.push({ testCaseId: testCase.id, engine: 'bruno-mcp', status: 'failed', durationMs: Date.now() - started, summary: error.message.slice(0, 500), details: '', runAt: new Date().toISOString() });
      }
    }
    return results;
  });
}

async function executeAutomation(request, runtime) {
  const agreed = (request.testCases || []).filter((item) => item.state === 'agreed');
  const webCases = agreed.filter((item) => (item.automationType || 'web') === 'web');
  const apiCases = agreed.filter((item) => item.automationType === 'api');
  if (!webCases.length && !apiCases.length) throw new Error('実行可能な合意済みWeb/APIケースがありません');
  const settings = { ...(request.settings || {}), runtimeDir: runtime.userDataPath };
  const results = [];
  if (webCases.length) results.push(...await executeWebCases(webCases, settings));
  if (apiCases.length) results.push(...await executeApiCases(apiCases, settings));
  return results;
}

module.exports = { executeAutomation, executeWebCases, executeApiCases, locatorCode, buildPlaywrightCode };
