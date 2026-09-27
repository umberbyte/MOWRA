const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function windowsCandidates(command, env = process.env) {
  const upper = command.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const candidates = [];
  if (env[`MOWRA_${upper}_PATH`]) candidates.push(env[`MOWRA_${upper}_PATH`]);
  if (command === 'codex' && env.LOCALAPPDATA) {
    const binRoot = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const versions = fs.readdirSync(binRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      candidates.push(...versions);
    } catch {}
  }
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', `${command}.cmd`));
  return candidates;
}

function lookupOnPath(command) {
  return new Promise((resolve) => {
    const lookup = spawn(process.platform === 'win32' ? 'where.exe' : 'which', [command], { windowsHide: true, shell: false });
    let stdout = '';
    lookup.stdout?.on('data', (chunk) => { stdout += chunk; });
    lookup.on('error', () => resolve(null));
    lookup.on('close', (code) => resolve(code === 0 ? stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null : null));
  });
}

function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 10_000);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? stdout : null); });
  });
}

async function resolveCodexMcp(name, codexCommand) {
  if (!codexCommand) return null;
  const output = await capture(codexCommand, ['mcp', 'get', name, '--json']);
  if (!output) return null;
  try {
    const config = JSON.parse(output);
    const transport = config.enabled !== false && config.transport?.type === 'stdio' ? config.transport : null;
    if (!transport?.command) return null;
    return { command: transport.command, args: transport.args || [], env: transport.env || {}, cwd: transport.cwd || null };
  } catch { return null; }
}

async function resolveCliCommand(command, env = process.env) {
  if (process.platform === 'win32') {
    const candidate = windowsCandidates(command, env).find((value) => value && fs.existsSync(value));
    if (candidate) return candidate;
  }
  return lookupOnPath(command);
}

module.exports = { resolveCliCommand, resolveCodexMcp, windowsCandidates };
