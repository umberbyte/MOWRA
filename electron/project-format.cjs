const { XMLBuilder, XMLParser } = require('fast-xml-parser');

const PROJECT_FORMAT_VERSION = '1.0';
const ARRAY_PATHS = new Set([
  'testprj.sources.source',
  'testprj.inputFiles.file',
  'testprj.referenceFiles.file',
  'testprj.viewpoints.viewpoint',
  'testprj.testCases.testCase',
  'testprj.testCases.testCase.steps.step',
  'testprj.analysis.questions.question'
]);

function text(value) {
  return value == null ? '' : String(value);
}

function serializeProject(project = {}) {
  const document = {
    testprj: {
      '@_version': PROJECT_FORMAT_VERSION,
      project: {
        name: text(project.projectName),
        targetUrl: text(project.targetUrl),
        mode: text(project.mode || 'ambiguous'),
        focus: text(project.focus || 'general'),
        activeFilter: text(project.filter || 'all'),
        activeStage: text(project.activeStage || 'viewpoints'),
        aiProvider: text(project.aiProvider || 'codex'),
        context: text(project.context)
      },
      sources: { source: (project.sources || []).map((source) => ({ '#text': text(source) })) },
      inputFiles: {
        file: (project.inputFiles || []).map((file) => ({
          '@_id': text(file.id),
          '@_extension': text(file.extension),
          '@_size': Number(file.size) || 0,
          '@_modifiedAt': Number(file.modifiedAt) || 0,
          '@_sourceType': text(file.sourceType || 'local-file'),
          name: text(file.name),
          path: text(file.path)
        }))
      },
      referenceFiles: {
        file: (project.referenceFiles || []).map((file) => ({
          '@_id': text(file.id),
          '@_extension': text(file.extension),
          '@_size': Number(file.size) || 0,
          '@_modifiedAt': Number(file.modifiedAt) || 0,
          '@_sourceType': text(file.sourceType || 'local-file'),
          name: text(file.name),
          path: text(file.path)
        }))
      },
      viewpoints: {
        viewpoint: (project.items || []).map((item) => ({
          '@_id': text(item.id),
          target: text(item.target),
          title: text(item.title),
          description: text(item.description),
          basis: text(item.basis),
          priority: text(item.priority),
          state: text(item.state),
          question: text(item.question)
        }))
      },
      testCases: {
        testCase: (project.testCases || []).map((testCase) => ({
          '@_id': text(testCase.id),
          '@_viewpointId': text(testCase.viewpointId),
          title: text(testCase.title),
          type: text(testCase.type),
          priority: text(testCase.priority),
          state: text(testCase.state),
          preconditions: text(testCase.preconditions),
          testData: text(testCase.testData),
          steps: {
            step: (testCase.steps || []).map((step, index) => ({
              '@_number': index + 1,
              action: text(step.action),
              expected: text(step.expected)
            }))
          }
        }))
      },
      analysis: {
        summary: text(project.analysisSummary),
        status: text(project.analysisStatus),
        inputSignature: text(project.analysisInputSignature),
        questions: { question: (project.analysisQuestions || []).map((question) => ({ '#text': text(question) })) }
      },
      testCaseAnalysis: {
        summary: text(project.testCaseSummary),
        status: text(project.caseGenerationStatus)
      }
    }
  };
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: false });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(document)}`;
}

function nodeText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && '#text' in value) return text(value['#text']);
  return text(value);
}

function deserializeProject(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
    isArray: (_name, path) => ARRAY_PATHS.has(path)
  });
  const root = parser.parse(xml)?.testprj;
  if (!root || root['@_version'] !== PROJECT_FORMAT_VERSION) throw new Error('対応していないtestprj形式です');
  const project = root.project || {};
  return {
    projectName: nodeText(project.name),
    targetUrl: nodeText(project.targetUrl),
    mode: nodeText(project.mode) || 'ambiguous',
    focus: nodeText(project.focus) || 'general',
    filter: nodeText(project.activeFilter) || 'all',
    activeStage: nodeText(project.activeStage) || 'viewpoints',
    aiProvider: nodeText(project.aiProvider) || 'codex',
    context: nodeText(project.context),
    sources: (root.sources?.source || []).map(nodeText),
    inputFiles: (root.inputFiles?.file || []).map((file) => ({
      id: text(file['@_id']), name: nodeText(file.name), path: nodeText(file.path),
      extension: text(file['@_extension']), size: Number(file['@_size']) || 0,
      modifiedAt: Number(file['@_modifiedAt']) || 0,
      sourceType: text(file['@_sourceType']) || 'local-file'
    })),
    referenceFiles: (root.referenceFiles?.file || []).map((file) => ({
      id: text(file['@_id']), name: nodeText(file.name), path: nodeText(file.path),
      extension: text(file['@_extension']), size: Number(file['@_size']) || 0,
      modifiedAt: Number(file['@_modifiedAt']) || 0,
      sourceType: text(file['@_sourceType']) || 'local-file'
    })),
    items: (root.viewpoints?.viewpoint || []).map((item) => ({
      id: text(item['@_id']), target: nodeText(item.target), title: nodeText(item.title),
      description: nodeText(item.description), basis: nodeText(item.basis),
      priority: nodeText(item.priority), state: nodeText(item.state), question: nodeText(item.question)
    })),
    testCases: (root.testCases?.testCase || []).map((testCase) => ({
      id: text(testCase['@_id']), viewpointId: text(testCase['@_viewpointId']),
      title: nodeText(testCase.title), type: nodeText(testCase.type),
      priority: nodeText(testCase.priority), state: nodeText(testCase.state),
      preconditions: nodeText(testCase.preconditions), testData: nodeText(testCase.testData),
      steps: (testCase.steps?.step || []).map((step) => ({
        action: nodeText(step.action), expected: nodeText(step.expected)
      }))
    })),
    analysisSummary: nodeText(root.analysis?.summary),
    analysisStatus: nodeText(root.analysis?.status),
    analysisInputSignature: nodeText(root.analysis?.inputSignature),
    analysisQuestions: (root.analysis?.questions?.question || []).map(nodeText),
    testCaseSummary: nodeText(root.testCaseAnalysis?.summary),
    caseGenerationStatus: nodeText(root.testCaseAnalysis?.status)
  };
}

module.exports = { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION };
