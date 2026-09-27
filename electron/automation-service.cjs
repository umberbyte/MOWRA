const path = require('node:path');
const { withStdioMcp, resultText } = require('./mcp-client.cjs');

function serverEnvironment(extra = {}) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extra };
}

function externalServer(command, args, settings, label, configuredEnv = {}, configuredCwd = null) {
  if (!command) throw new Error(`${label}が見つかりません。CodexのMCP登録またはPCのPATHを確認してください`);
  const pathEnv = settings.externalBinPath ? { PATH: `${settings.externalBinPath}${path.delimiter}${process.env.PATH || ''}` } : {};
  const env = serverEnvironment({ ...configuredEnv, ...pathEnv });
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', [quote(command), ...args.map(quote)].join(' ')], cwd: configuredCwd || settings.runtimeDir, env };
  }
  return { command, args, cwd: configuredCwd || settings.runtimeDir, env };
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

const WEB_OPERATIONS = new Set(['click', 'fill', 'check', 'press', 'select']);
const WEB_ASSERTIONS = new Set(['visible', 'text', 'value']);

function validateAutomationCase(testCase, settings = {}) {
  const type = testCase.automationType || 'web';
  const reasons = [];
  if (type === 'manual') reasons.push('手動ケースです');
  if (type === 'api') {
    if (Object.hasOwn(settings, 'brunoMcpCommand') && !settings.brunoMcpCommand) reasons.push('Bruno MCPがCodex設定またはPATHに見つかりません');
    if (!settings.collectionPath) reasons.push('Brunoコレクションが未設定です');
    if (!testCase.brunoRequestPath || /^要確認\s*[:：]/.test(testCase.brunoRequestPath)) reasons.push('Brunoリクエスト相対パスが未設定です');
  }
  if (type === 'web') {
    if (Object.hasOwn(settings, 'playwrightMcpCommand') && !settings.playwrightMcpCommand) reasons.push('Playwright MCPがCodex設定またはPATHに見つかりません');
    if (!/^https?:\/\//i.test(String(settings.targetUrl || ''))) reasons.push('http/httpsの対象URLが未設定です');
    if (!testCase.steps?.length) reasons.push('テスト手順がありません');
    (testCase.steps || []).forEach((step, index) => {
      const prefix = `手順${index + 1}`;
      try { locatorCode(step.actionLocator || ''); } catch { reasons.push(`${prefix}の操作ロケーターが未確定です`); }
      try { locatorCode(step.expectedLocator || ''); } catch { reasons.push(`${prefix}の確認ロケーターが未確定です`); }
      const operation = inferOperation(step);
      if (!WEB_OPERATIONS.has(operation)) reasons.push(`${prefix}の操作種別が未設定です`);
      if (['fill', 'press', 'select'].includes(operation) && !String(step.actionValue || testCase.testData || '').trim()) reasons.push(`${prefix}の操作値が未設定です`);
      if (!WEB_ASSERTIONS.has(step.assertion || '')) reasons.push(`${prefix}の検証種別が未設定です`);
      if (['text', 'value'].includes(step.assertion) && !String(step.expectedValue || '').trim()) reasons.push(`${prefix}の期待値が未設定です`);
    });
  }
  return { runnable: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function blockedResult(testCase, settings) {
  const validation = validateAutomationCase(testCase, settings);
  return {
    testCaseId: testCase.id,
    engine: (testCase.automationType || 'web') === 'api' ? 'bruno-mcp' : 'playwright-mcp',
    status: 'blocked', durationMs: 0,
    summary: validation.reasons.join(' / '), details: '', runAt: new Date().toISOString()
  };
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
  const server = externalServer(settings.playwrightMcpCommand, [...(settings.playwrightMcpArgs || []), '--headless', '--isolated', '--browser', settings.browser || 'msedge'], settings, 'Playwright MCP', settings.playwrightMcpEnv, settings.playwrightMcpCwd);
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
  const server = externalServer(settings.brunoMcpCommand, [...(settings.brunoMcpArgs || []), '--collection', collectionPath], settings, 'Bruno MCP', settings.brunoMcpEnv, settings.brunoMcpCwd);
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
  const settings = { ...(request.settings || {}), runtimeDir: runtime.userDataPath };
  const automatable = agreed.filter((item) => ['web', 'api'].includes(item.automationType || 'web'));
  const blocked = automatable.filter((item) => !validateAutomationCase(item, settings).runnable);
  const runnable = automatable.filter((item) => validateAutomationCase(item, settings).runnable);
  const webCases = runnable.filter((item) => (item.automationType || 'web') === 'web');
  const apiCases = runnable.filter((item) => item.automationType === 'api');
  if (!automatable.length) throw new Error('合意済みWeb/APIケースがありません');
  const results = blocked.map((item) => blockedResult(item, settings));
  if (webCases.length) results.push(...await executeWebCases(webCases, settings));
  if (apiCases.length) results.push(...await executeApiCases(apiCases, settings));
  return results;
}

module.exports = { executeAutomation, executeWebCases, executeApiCases, validateAutomationCase, locatorCode, buildPlaywrightCode };
