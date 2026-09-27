const { invokeStructuredAi } = require('./analysis-service.cjs');

const FAST_BATCH_SIZE = 12;

function buildTestCasePrompt({ viewpoints, project }) {
  const compactViewpoints = viewpoints.map((item) => [
    item.id, item.target, item.title, item.description, item.priority
  ]);
  const context = String(project.context || 'なし').slice(0, 800);
  return `ISTQB/JSTQB Foundation相当のテスト設計者として、合意済み観点を実行可能なテストケースにする。JSONスキーマだけを返す。

案件: ${project.projectName || '名称未設定'}
URL: ${project.targetUrl || '未設定'}
モード: ${project.mode === 'ambiguous' ? 'あいまいテスト' : '仕様準拠'}
前提: ${context}

入力配列の順序は [viewpointId, 対象, 観点, 確認内容, 優先度]。
${JSON.stringify(compactViewpoints)}

規則:
- 各viewpointIdにつき、最も重要で代表的なケースを必ず1件だけ生成する。
- 元のviewpointIdと優先度を維持する。
- 手順は判定に必要な最短の2〜5段階にし、各操作に観察可能な期待結果を書く。
- 各手順の操作対象と確認対象をDOM上で1件に特定できるPlaywrightロケーター候補にする。
- ロケーターは getByRole(..., { name: ..., exact: true })、getByLabel(..., { exact: true })、getByTestId(...)、一意なidの順で優先する。button、.btn、部分一致テキストだけの曖昧な指定は禁止する。
- actionTarget/actionLocatorは操作する部品、expectedTarget/expectedLocatorは期待結果を観察する部品またはテキストを示す。
- operationはnone/click/fill/select/check/press、actionValueは入力値・選択値・キーを記載する。assertionはvisible/text/value、expectedValueは比較値を記載する。
- 資料から一意な候補を作れない場合、ロケーターを「要確認: 対象を一意にする情報」の形式にし、ケースのstateをreviewにする。後続のPlaywright実行で候補の一致件数が1件であることを検証する。
- 画面操作はautomationTypeをwebにする。API検証はapiにし、既存Brunoコレクションの相対.bruパスが資料にあればbrunoRequestPathへ記載する。不明なら「要確認: Brunoリクエスト相対パス」としてstateをreviewにする。自動化対象外はmanualにする。
- 観点に最適な同値分割、境界値、状態遷移、エラー推測のいずれかを選びtypeへ反映する。
- 資料にない値は断定せず、プレースホルダーか事前条件にする。仮定を含む場合はstateをreviewにする。
- summaryは生成内容を示す1文だけにする。`;
}

function normalizeTestCaseResult(result, viewpoints) {
  if (!result || !Array.isArray(result.testCases)) throw new Error('AIのテストケース応答形式が正しくありません');
  const viewpointIds = new Set(viewpoints.map((item) => item.id));
  const priorities = new Set(['高', '中', '低']);
  const types = new Set(['正常系', '異常系', '境界値', '状態遷移', '探索的']);
  const states = new Set(['draft', 'review']);
  const automationTypes = new Set(['web', 'api', 'manual']);
  const operations = new Set(['none', 'click', 'fill', 'select', 'check', 'press']);
  const assertions = new Set(['visible', 'text', 'value']);
  const requiredText = (value, label, max = 1500) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}が正しくありません`);
    return value.trim().slice(0, max);
  };
  const seen = new Set();
  const testCases = result.testCases.map((item, caseIndex) => {
    if (!item || typeof item !== 'object') throw new Error(`テストケース${caseIndex + 1}の形式が正しくありません`);
    const viewpointId = requiredText(item.viewpointId, `テストケース${caseIndex + 1}のviewpointId`, 100);
    if (!viewpointIds.has(viewpointId)) throw new Error(`テストケース${caseIndex + 1}が未定義の観点を参照しています`);
    if (seen.has(viewpointId)) return null;
    seen.add(viewpointId);
    if (!Array.isArray(item.steps) || item.steps.length === 0) throw new Error(`テストケース${caseIndex + 1}の手順がありません`);
    const automationType = automationTypes.has(item.automationType) ? item.automationType : 'manual';
    let locatorNeedsReview = automationType === 'manual';
    const normalizeLocator = (value, label) => {
      const locator = requiredText(value, label, 500);
      const confirmedCandidate = /^getByTestId\(/.test(locator)
        || (/^getBy(?:Role|Label)\(/.test(locator) && /exact\s*:\s*true/.test(locator))
        || /^locator\(\s*['"]#[A-Za-z][\w:.-]*['"]\s*\)$/.test(locator);
      const needsReview = automationType === 'web' && (/^要確認\s*[:：]/.test(locator) || !confirmedCandidate);
      if (needsReview) locatorNeedsReview = true;
      return needsReview && !/^要確認\s*[:：]/.test(locator) ? `要確認: ${locator}` : locator;
    };
    const steps = item.steps.slice(0, 5).map((step, stepIndex) => ({
      actionTarget: requiredText(step?.actionTarget, `テストケース${caseIndex + 1}の操作対象${stepIndex + 1}`, 240),
      actionLocator: normalizeLocator(step?.actionLocator, `テストケース${caseIndex + 1}の操作ロケーター${stepIndex + 1}`),
      operation: operations.has(step?.operation) ? step.operation : 'none',
      actionValue: typeof step?.actionValue === 'string' ? step.actionValue.trim().slice(0, 1000) : '',
      action: requiredText(step?.action, `テストケース${caseIndex + 1}の手順${stepIndex + 1}`),
      expectedTarget: requiredText(step?.expectedTarget, `テストケース${caseIndex + 1}の確認対象${stepIndex + 1}`, 240),
      expectedLocator: normalizeLocator(step?.expectedLocator, `テストケース${caseIndex + 1}の確認ロケーター${stepIndex + 1}`),
      assertion: assertions.has(step?.assertion) ? step.assertion : 'visible',
      expectedValue: typeof step?.expectedValue === 'string' ? step.expectedValue.trim().slice(0, 1000) : '',
      expected: requiredText(step?.expected, `テストケース${caseIndex + 1}の期待結果${stepIndex + 1}`)
    }));
    return {
      viewpointId,
      title: requiredText(item.title, `テストケース${caseIndex + 1}のtitle`, 240),
      type: types.has(item.type) ? item.type : '探索的',
      priority: priorities.has(item.priority) ? item.priority : '中',
      automationType,
      brunoRequestPath: typeof item.brunoRequestPath === 'string' ? item.brunoRequestPath.trim().slice(0, 1000) : '',
      preconditions: requiredText(item.preconditions, `テストケース${caseIndex + 1}のpreconditions`),
      testData: requiredText(item.testData, `テストケース${caseIndex + 1}のtestData`),
      steps,
      state: states.has(item.state) && !locatorNeedsReview && !(automationType === 'api' && (!item.brunoRequestPath || /^要確認\s*[:：]/.test(item.brunoRequestPath))) ? item.state : 'review'
    };
  }).filter(Boolean);
  const missing = viewpoints.filter((item) => !seen.has(item.id));
  if (missing.length) throw new Error(`AI応答にケースがない観点があります: ${missing.map((item) => item.id).join(', ')}`);
  return {
    summary: typeof result.summary === 'string' ? result.summary.trim().slice(0, 500) : '',
    testCases
  };
}

async function generateTestCases(request, runtime, invokeAi = invokeStructuredAi) {
  if (!request.confirmedExternalTransmission) throw new Error('AIサービスへの観点送信確認が必要です');
  if (!['codex', 'claude'].includes(request.provider)) throw new Error('未対応のAIプロバイダーです');
  const viewpoints = Array.isArray(request.viewpoints) ? request.viewpoints.filter((item) => item?.state === 'agreed') : [];
  if (!viewpoints.length) throw new Error('未生成の合意済みテスト観点がありません');
  const generated = [];
  const summaries = [];
  for (let offset = 0; offset < viewpoints.length; offset += FAST_BATCH_SIZE) {
    const batch = viewpoints.slice(offset, offset + FAST_BATCH_SIZE);
    try {
      const result = await invokeAi(request.provider, buildTestCasePrompt({ viewpoints: batch, project: request.project || {} }), runtime, batch);
      const normalized = normalizeTestCaseResult(result, batch);
      generated.push(...normalized.testCases);
      if (normalized.summary) summaries.push(normalized.summary);
    } catch (error) {
      throw new Error(`観点${offset + 1}〜${offset + batch.length}件目の生成に失敗しました: ${error.message}`);
    }
  }
  return { summary: summaries.join(' '), testCases: generated };
}

module.exports = { generateTestCases, buildTestCasePrompt, normalizeTestCaseResult, FAST_BATCH_SIZE };
