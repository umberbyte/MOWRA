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

function withoutCliOptions(args, names) {
  const blocked = new Set(names);
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const value = String(args[index]);
    const option = value.split('=', 1)[0];
    if (!blocked.has(option)) {
      result.push(value);
      continue;
    }
    if (!value.includes('=') && index + 1 < args.length && !String(args[index + 1]).startsWith('--')) index++;
  }
  return result;
}

function playwrightServerEnvironment(configuredEnv = {}) {
  const bypass = ['localhost', '127.0.0.1', '::1'];
  const existing = configuredEnv.NO_PROXY || configuredEnv.no_proxy || process.env.NO_PROXY || process.env.no_proxy || '';
  const noProxy = [...new Set([...String(existing).split(',').map((value) => value.trim()).filter(Boolean), ...bypass])].join(',');
  return { ...configuredEnv, NO_PROXY: noProxy, no_proxy: noProxy };
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
  match = /^getByPlaceholder\('((?:\\'|[^'])+)'\s*,\s*\{\s*exact:\s*true\s*\}\)$/.exec(locator);
  if (match) return `page.getByPlaceholder(${JSON.stringify(parseQuoted(match[1]))}, { exact: true })`;
  match = /^locator\('(#(?:[A-Za-z][\w:.-]*))'\)$/.exec(locator);
  if (match) return `page.locator(${JSON.stringify(match[1])})`;
  throw new Error(`未対応または要確認のロケーターです: ${locator}`);
}

function runtimeLocatorHelperSource() {
  return String.raw`
const normalizeName = (value) => String(value || '').toLowerCase().replace(/[\s　・_\-／/「」『』（）()]/g, '').replace(/(入力欄|選択欄|フィールド|ボタン|リンク|コントロール|メッセージ|案内|表示)$/g, '');
const aliasesFor = (value) => {
  const raw = String(value || ''); const normalized = normalizeName(raw); const aliases = [normalized];
  if (/検索/.test(normalized) && /(入力|キーワード|検索欄)/.test(raw)) aliases.push('search','keyword');
  const dictionary = [['数量','quantity','qty'],['買い物かご','cart'],['カート','cart'],['都道府県','prefecture','state'],['郵便番号','postal','zip'],['住所','address'],['氏名','name'],['メール','email'],['電話','tel','phone'],['決済','payment'],['クーポン','coupon'],['備考','note','comment'],['再生','play']];
  for (const row of dictionary) if (normalized.includes(row[0])) aliases.push(...row.slice(1));
  return [...new Set(aliases.filter(Boolean))];
};
const roleFor = (element) => element.getAttribute('role') || ({A:'link',BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox'}[element.tagName] || (element.tagName === 'INPUT' ? (element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : element.type === 'submit' || element.type === 'button' ? 'button' : element.type === 'search' ? 'searchbox' : 'textbox') : ''));
const uniqueLocatorFor = async (info) => {
  if (info.id && /^[A-Za-z][\w:.-]*$/.test(info.id)) { const locator = page.locator('#' + info.id); if (await locator.count() === 1) return { locator, canonical: "locator('#" + info.id.replace(/'/g, "\\'") + "')" }; }
  if (info.label) { const locator = page.getByLabel(info.label, { exact: true }); if (await locator.count() === 1) return { locator, canonical: "getByLabel('" + info.label.replace(/'/g, "\\'") + "', { exact: true })" }; }
  if (info.placeholder) { const locator = page.getByPlaceholder(info.placeholder, { exact: true }); if (await locator.count() === 1) return { locator, canonical: "getByPlaceholder('" + info.placeholder.replace(/'/g, "\\'") + "', { exact: true })" }; }
  if (info.role && info.accessibleName) { const locator = page.getByRole(info.role, { name: info.accessibleName, exact: true }); if (await locator.count() === 1) return { locator, canonical: "getByRole('" + info.role.replace(/'/g, "\\'") + "', { name: '" + info.accessibleName.replace(/'/g, "\\'") + "', exact: true })" }; }
  return null;
};
const discoverUnique = async (targetName, operation, expectedValue) => {
  const selector = ['fill','press'].includes(operation) ? 'input:not([type=hidden]),textarea,[contenteditable=true]' : operation === 'select' ? 'select' : operation === 'check' ? 'input[type=checkbox],input[type=radio],[role=checkbox],[role=radio]' : operation === 'click' ? 'button,a,input[type=submit],input[type=button],[role=button],[role=link],video' : 'h1,h2,h3,[role=status],[role=alert],output,input:not([type=hidden]),select,textarea,button,a,p,li,td,span';
  const aliases = aliasesFor(targetName); const expectedAliases = aliasesFor(expectedValue);
  const candidates = await page.locator(selector).evaluateAll((elements, payload) => elements.map((element, index) => {
    const label = element.labels && element.labels[0] ? element.labels[0].innerText.trim() : '';
    const accessibleName = (element.getAttribute('aria-label') || label || element.innerText || element.value || element.getAttribute('title') || '').trim().slice(0, 160);
    const fields = [accessibleName,label,element.getAttribute('placeholder'),element.id,element.getAttribute('name'),element.getAttribute('title'),element.innerText].filter(Boolean).map((value) => String(value).toLowerCase().replace(/[\s　・_\-／/「」『』（）()]/g, ''));
    let score = 0;
    for (const alias of payload.aliases) for (const field of fields) { if (field === alias) score = Math.max(score,100); else if (field.includes(alias) || (field.length >= 3 && alias.includes(field))) score = Math.max(score,70 + Math.min(alias.length,field.length)); }
    for (const alias of payload.expectedAliases) for (const field of fields) if (alias && (field.includes(alias) || (field.length >= 3 && alias.includes(field)))) score = Math.max(score,55 + Math.min(alias.length,field.length));
    if (element.id) score += 4; if (label || element.getAttribute('aria-label')) score += 5;
    const style = getComputedStyle(element); const visible = !!(element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none');
    return { index,score,visible,id:element.id,label,placeholder:element.getAttribute('placeholder')||'',role:element.getAttribute('role')||({A:'link',BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox'}[element.tagName]||(element.tagName==='INPUT'?(element.type==='checkbox'?'checkbox':element.type==='radio'?'radio':element.type==='submit'||element.type==='button'?'button':element.type==='search'?'searchbox':'textbox'):'')),accessibleName,tag:element.tagName.toLowerCase() };
  }), { aliases, expectedAliases });
  candidates.sort((left,right) => right.score-left.score);
  for (const candidate of candidates.filter((item) => item.visible && item.score >= 60).slice(0,8)) { const unique = await uniqueLocatorFor(candidate); if (unique) return { ...unique, score:candidate.score }; }
  return null;
};
const sameOriginRoutes = async (baseUrl) => { const origin = await page.evaluate((value) => new URL(value).origin, baseUrl); return await page.locator('a[href]').evaluateAll((links, origin) => [...new Set(links.map((link) => link.href).filter((href) => { try { const url = new URL(href); return url.origin === origin && !url.hash && !/logout|delete|remove/i.test(url.pathname); } catch { return false; } }))].slice(0,30), origin); };
const resolveAcrossSite = async (preferred, targetName, operation, expectedValue, routes, allowNavigation) => {
  if (await preferred.count() === 1) return { locator:preferred,canonical:null,repaired:false,url:page.url(),searched:1 };
  let found = await discoverUnique(targetName,operation,expectedValue); if (found) return { ...found,repaired:true,url:page.url(),searched:1 };
  if (!allowNavigation) return null;
  let searched = 1;
  for (const route of routes) { if (route === page.url()) continue; searched++; await page.goto(route,{waitUntil:'domcontentloaded'}); found = await discoverUnique(targetName,operation,expectedValue); if (found) return { ...found,repaired:true,url:page.url(),searched }; }
  return { missing:true,searched };
};`;
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
    'const evidence = []; const repairs = [];',
    runtimeLocatorHelperSource(),
    `const routes = await sameOriginRoutes(${JSON.stringify(targetUrl)});`,
    'try {'
  ];
  (testCase.steps || []).forEach((step, index) => {
    const action = locatorCode(step.actionLocator);
    const expected = locatorCode(step.expectedLocator);
    const operation = inferOperation(step);
    lines.push(`{ const preferredAction = ${action}; const actionResolved = await resolveAcrossSite(preferredAction, ${JSON.stringify(step.actionTarget)}, ${JSON.stringify(operation)}, ${JSON.stringify(step.actionValue || testCase.testData || '')}, routes, ${index === 0}); if (!actionResolved || actionResolved.missing) throw new Error('MOWRA_ACTION_NOT_FOUND|${index + 1}|' + ${JSON.stringify(step.actionTarget)} + '|' + (actionResolved?.searched || 1)); const actionTarget = actionResolved.locator; evidence.push({ step: ${index + 1}, kind: 'action', count: 1, url: actionResolved.url, repaired: actionResolved.repaired }); if (actionResolved.repaired && actionResolved.canonical) repairs.push({ stepIndex:${index}, field:'actionLocator', value:actionResolved.canonical, url:actionResolved.url });`);
    if (operation === 'click') lines.push('await actionTarget.click();');
    else if (operation === 'fill') lines.push(`await actionTarget.fill(${JSON.stringify(step.actionValue || testCase.testData || '')});`);
    else if (operation === 'check') lines.push('await actionTarget.check();');
    else if (operation === 'press') lines.push(`await actionTarget.press(${JSON.stringify(step.actionValue || 'Enter')});`);
    else if (operation === 'select') lines.push(`await actionTarget.selectOption(${JSON.stringify(step.actionValue || '')});`);
    lines.push(`const preferredExpected = ${expected}; const expectedResolved = await resolveAcrossSite(preferredExpected, ${JSON.stringify(step.expectedTarget)}, 'observe', ${JSON.stringify(step.expectedValue || '')}, routes, false); if (!expectedResolved) throw new Error('MOWRA_EXPECTED_NOT_FOUND|${index + 1}|' + ${JSON.stringify(step.expectedTarget)}); const expectedTarget = expectedResolved.locator; evidence.push({ step: ${index + 1}, kind: 'expected', count: 1, url: expectedResolved.url, repaired: expectedResolved.repaired }); if (expectedResolved.repaired && expectedResolved.canonical) repairs.push({ stepIndex:${index}, field:'expectedLocator', value:expectedResolved.canonical, url:expectedResolved.url }); await expectedTarget.waitFor({ state: 'visible' });`);
    if (step.assertion === 'text' && step.expectedValue) lines.push(`if ((await expectedTarget.innerText()).trim() !== ${JSON.stringify(step.expectedValue)}) throw new Error('手順${index + 1}のテキストが期待値と一致しません');`);
    else if (step.assertion === 'value' && step.expectedValue) lines.push(`if (await expectedTarget.inputValue() !== ${JSON.stringify(step.expectedValue)}) throw new Error('手順${index + 1}の値が期待値と一致しません');`);
    lines.push('}');
  });
  lines.push("return { passed: true, evidence, repairs, url: page.url(), title: await page.title() };", "} catch (error) { return { passed: false, error: String(error?.message || error), evidence, repairs, url: page.url(), title: await page.title() }; }", '}');
  return lines.join('\n');
}

function parsePlaywrightOutput(result) {
  const text = String(resultText(result) || '');
  if (result?.isError) throw new Error(text || 'MCPツールが失敗しました');
  const match = /^### Result\s*\r?\n([\s\S]*?)(?:\r?\n### |$)/m.exec(text);
  if (match) { try { return { value: JSON.parse(match[1].trim()), text }; } catch {} }
  return { value: result?.structuredContent || null, text };
}

function friendlyPlaywrightError(message) {
  const action = /MOWRA_ACTION_NOT_FOUND\|(\d+)\|([^|]+)\|(\d+)/.exec(message);
  if (action) return `手順${action[1]}：対象サイト内を${action[3]}画面探索しましたが、操作対象「${action[2]}」が見つかりません。ケースの前提または実装を確認してください`;
  const expected = /MOWRA_EXPECTED_NOT_FOUND\|(\d+)\|([^\r\n]+)/.exec(message);
  if (expected) return `手順${expected[1]}：操作後に確認対象「${expected[2]}」が見つかりません。期待する表示が実装されているか確認してください`;
  return String(message || 'Playwrightテストに失敗しました').slice(0, 500);
}

function summarizeToolResult(result) {
  const text = resultText(result);
  if (result?.isError) throw new Error(text || 'MCPツールが失敗しました');
  return result?.structuredContent || text;
}

async function executeWebCases(testCases, settings) {
  const targetUrl = String(settings.targetUrl || '');
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('Webテストにはhttp/httpsの対象URLが必要です');
  const configuredArgs = withoutCliOptions(settings.playwrightMcpArgs || [], ['--browser', '--proxy-server', '--proxy-bypass', '--headless', '--isolated']);
  const server = externalServer(settings.playwrightMcpCommand, [...configuredArgs, '--headless', '--isolated', '--browser', settings.browser || 'msedge'], settings, 'Playwright MCP', playwrightServerEnvironment(settings.playwrightMcpEnv), settings.playwrightMcpCwd);
  return withStdioMcp(server, async (client) => {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === 'browser_run_code_unsafe')) throw new Error('Playwright MCPにbrowser_run_code_unsafeツールがありません');
    const results = [];
    for (const testCase of testCases) {
      const started = Date.now();
      try {
        const toolResult = await client.callTool({ name: 'browser_run_code_unsafe', arguments: { code: buildPlaywrightCode(testCase, targetUrl) } }, undefined, { timeout: 120_000 });
        const output = parsePlaywrightOutput(toolResult);
        const repairs = output.value?.repairs || [];
        if (output.value?.passed === false) results.push({ testCaseId: testCase.id, engine: 'playwright-mcp', status: 'failed', durationMs: Date.now() - started, summary: friendlyPlaywrightError(output.value.error), details: JSON.stringify(output.value).slice(0, 8000), repairs, runAt: new Date().toISOString() });
        else results.push({ testCaseId: testCase.id, engine: 'playwright-mcp', status: 'passed', durationMs: Date.now() - started, summary: repairs.length ? `DOMを探索して${repairs.length}件のロケーターを自動修復し、操作・表示確認が完了しました` : 'DOM一意性、操作、表示確認が完了しました', details: JSON.stringify(output.value || output.text).slice(0, 8000), repairs, runAt: new Date().toISOString() });
      } catch (error) {
        results.push({ testCaseId: testCase.id, engine: 'playwright-mcp', status: 'failed', durationMs: Date.now() - started, summary: friendlyPlaywrightError(error.message), details: String(error.message || '').slice(0, 8000), runAt: new Date().toISOString() });
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

module.exports = { executeAutomation, executeWebCases, executeApiCases, validateAutomationCase, locatorCode, buildPlaywrightCode, parsePlaywrightOutput, friendlyPlaywrightError, withoutCliOptions, playwrightServerEnvironment };
