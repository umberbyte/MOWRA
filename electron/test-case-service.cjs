const { invokeStructuredAi } = require('./analysis-service.cjs');

function buildTestCasePrompt({ viewpoints, project }) {
  const viewpointText = viewpoints.map((item) => [
    `<viewpoint id="${item.id}">`,
    `対象: ${item.target}`,
    `観点: ${item.title}`,
    `確認内容: ${item.description}`,
    `根拠: ${item.basis}`,
    `優先度: ${item.priority}`,
    '</viewpoint>'
  ].join('\n')).join('\n\n');
  return `あなたはISTQB/JSTQB Foundation相当のテスト設計担当者です。
顧客と合意済みのテスト観点を、実行可能で再現性のあるテストケースへ具体化してください。
指定されたJSONスキーマだけを返してください。

案件名: ${project.projectName || '名称未設定'}
対象URL: ${project.targetUrl || '未設定'}
設計モード: ${project.mode === 'ambiguous' ? 'あいまいテスト' : '仕様準拠'}
案件の前提: ${project.context || 'なし'}

規則:
- 各ケースは1つの検証目的に絞り、元のviewpointIdを必ず維持する。
- 操作手順と、各手順の観察可能な期待結果を対で記述する。
- 必要に応じて同値分割、境界値分析、状態遷移、デシジョンテーブル、エラー推測を使う。
- 正常系だけでなく、観点に適する異常系・境界値も生成する。
- 各観点につき重要なケースを1〜3件に絞る。
- 資料にない具体値、アカウント、環境は断定せず、プレースホルダーまたは事前条件として明示する。
- 合意済み観点から直接導けない仮定が含まれるケースはstateをreviewにする。
- 期待結果に「正しく表示される」などの曖昧な表現を使わず、判定できる状態を書く。
- 同じ目的・手順の重複ケースを作らない。

合意済みテスト観点:
${viewpointText}`;
}

function normalizeTestCaseResult(result, viewpoints) {
  if (!result || !Array.isArray(result.testCases)) throw new Error('AIのテストケース応答形式が正しくありません');
  const viewpointIds = new Set(viewpoints.map((item) => item.id));
  const priorities = new Set(['高', '中', '低']);
  const types = new Set(['正常系', '異常系', '境界値', '状態遷移', '探索的']);
  const states = new Set(['draft', 'review']);
  const requiredText = (value, label, max = 3000) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}が正しくありません`);
    return value.trim().slice(0, max);
  };
  const testCases = result.testCases.slice(0, 60).map((item, caseIndex) => {
    if (!item || typeof item !== 'object') throw new Error(`テストケース${caseIndex + 1}の形式が正しくありません`);
    const viewpointId = requiredText(item.viewpointId, `テストケース${caseIndex + 1}のviewpointId`, 100);
    if (!viewpointIds.has(viewpointId)) throw new Error(`テストケース${caseIndex + 1}が未定義の観点を参照しています`);
    if (!Array.isArray(item.steps) || item.steps.length === 0) throw new Error(`テストケース${caseIndex + 1}の手順がありません`);
    return {
      viewpointId,
      title: requiredText(item.title, `テストケース${caseIndex + 1}のtitle`, 300),
      type: types.has(item.type) ? item.type : '探索的',
      priority: priorities.has(item.priority) ? item.priority : '中',
      preconditions: requiredText(item.preconditions, `テストケース${caseIndex + 1}のpreconditions`),
      testData: requiredText(item.testData, `テストケース${caseIndex + 1}のtestData`),
      steps: item.steps.slice(0, 20).map((step, stepIndex) => ({
        action: requiredText(step?.action, `テストケース${caseIndex + 1}の手順${stepIndex + 1}`),
        expected: requiredText(step?.expected, `テストケース${caseIndex + 1}の期待結果${stepIndex + 1}`)
      })),
      state: states.has(item.state) ? item.state : 'review'
    };
  });
  return {
    summary: typeof result.summary === 'string' ? result.summary.trim().slice(0, 4000) : '',
    testCases
  };
}

async function generateTestCases(request, runtime, invokeAi = invokeStructuredAi) {
  if (!request.confirmedExternalTransmission) throw new Error('AIサービスへの観点送信確認が必要です');
  if (!['codex', 'claude'].includes(request.provider)) throw new Error('未対応のAIプロバイダーです');
  const viewpoints = Array.isArray(request.viewpoints) ? request.viewpoints.filter((item) => item?.state === 'agreed') : [];
  if (!viewpoints.length) throw new Error('合意済みのテスト観点がありません');
  const batchSize = 4;
  const generated = [];
  const summaries = [];
  for (let offset = 0; offset < viewpoints.length; offset += batchSize) {
    const batch = viewpoints.slice(offset, offset + batchSize);
    const prompt = buildTestCasePrompt({ viewpoints: batch, project: request.project || {} });
    try {
      const result = await invokeAi(request.provider, prompt, runtime, batch);
      const normalized = normalizeTestCaseResult(result, batch);
      generated.push(...normalized.testCases);
      if (normalized.summary) summaries.push(normalized.summary);
    } catch (error) {
      const range = `${offset + 1}〜${offset + batch.length}件目`;
      throw new Error(`観点${range}のケース生成に失敗しました: ${error.message}`);
    }
  }
  return { summary: summaries.join('\n'), testCases: generated.slice(0, 60) };
}

module.exports = { generateTestCases, buildTestCasePrompt, normalizeTestCaseResult };
