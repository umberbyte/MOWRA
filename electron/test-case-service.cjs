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
    return {
      viewpointId,
      title: requiredText(item.title, `テストケース${caseIndex + 1}のtitle`, 240),
      type: types.has(item.type) ? item.type : '探索的',
      priority: priorities.has(item.priority) ? item.priority : '中',
      preconditions: requiredText(item.preconditions, `テストケース${caseIndex + 1}のpreconditions`),
      testData: requiredText(item.testData, `テストケース${caseIndex + 1}のtestData`),
      steps: item.steps.slice(0, 5).map((step, stepIndex) => ({
        action: requiredText(step?.action, `テストケース${caseIndex + 1}の手順${stepIndex + 1}`),
        expected: requiredText(step?.expected, `テストケース${caseIndex + 1}の期待結果${stepIndex + 1}`)
      })),
      state: states.has(item.state) ? item.state : 'review'
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
