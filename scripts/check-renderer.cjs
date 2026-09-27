const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (scripts.length !== 1) throw new Error(`Expected one inline script, found ${scripts.length}`);
new Function(scripts[0]);
console.log('Renderer script syntax is valid.');
