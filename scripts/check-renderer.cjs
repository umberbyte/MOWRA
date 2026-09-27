const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (scripts.length !== 1) throw new Error(`Expected one inline script, found ${scripts.length}`);
new Function(scripts[0]);
for (const name of ['generateCases', 'runAutomation', 'selectBrunoCollection', 'clearViewpoints', 'clearCases', 'exportCsv', 'boot']) {
  if (!new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(scripts[0])) {
    throw new Error(`Required renderer function is missing: ${name}`);
  }
}
for (const id of ['clearViewpointsBtn', 'clearCasesBtn']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Required renderer control is missing: ${id}`);
}
console.log('Renderer script syntax is valid.');
