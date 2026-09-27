const { XMLBuilder, XMLParser } = require('fast-xml-parser');

const PROJECT_FORMAT_VERSION = '1.0';
const ARRAY_PATHS = new Set([
  'testprj.sources.source',
  'testprj.inputFiles.file',
  'testprj.viewpoints.viewpoint',
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
        aiProvider: text(project.aiProvider || 'codex'),
        context: text(project.context)
      },
      sources: { source: (project.sources || []).map((source) => ({ '#text': text(source) })) },
      inputFiles: {
        file: (project.inputFiles || []).map((file) => ({
          '@_id': text(file.id),
          '@_extension': text(file.extension),
          '@_size': Number(file.size) || 0,
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
      analysis: {
        summary: text(project.analysisSummary),
        questions: { question: (project.analysisQuestions || []).map((question) => ({ '#text': text(question) })) }
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
    aiProvider: nodeText(project.aiProvider) || 'codex',
    context: nodeText(project.context),
    sources: (root.sources?.source || []).map(nodeText),
    inputFiles: (root.inputFiles?.file || []).map((file) => ({
      id: text(file['@_id']), name: nodeText(file.name), path: nodeText(file.path),
      extension: text(file['@_extension']), size: Number(file['@_size']) || 0,
      sourceType: text(file['@_sourceType']) || 'local-file'
    })),
    items: (root.viewpoints?.viewpoint || []).map((item) => ({
      id: text(item['@_id']), target: nodeText(item.target), title: nodeText(item.title),
      description: nodeText(item.description), basis: nodeText(item.basis),
      priority: nodeText(item.priority), state: nodeText(item.state), question: nodeText(item.question)
    })),
    analysisSummary: nodeText(root.analysis?.summary),
    analysisQuestions: (root.analysis?.questions?.question || []).map(nodeText)
  };
}

module.exports = { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION };
