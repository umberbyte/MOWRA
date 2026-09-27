import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: process.env });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const server = new McpServer({ name: 'mowra-bruno-mcp', version: '0.1.0' });
server.registerTool('execute_request', {
  title: 'Execute a Bruno request',
  description: 'Bruno CLIでコレクション内の1リクエストを実行し、JSONレポートを返します。',
  inputSchema: {
    collectionPath: z.string(),
    requestPath: z.string(),
    environment: z.string().optional()
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
}, async ({ collectionPath, requestPath, environment }) => {
  const collection = path.resolve(collectionPath);
  const request = path.resolve(collection, requestPath);
  if (!request.startsWith(`${collection}${path.sep}`) || path.extname(request).toLowerCase() !== '.bru') {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Brunoリクエストはコレクション内の.bruファイルを指定してください' }) }] };
  }
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mowra-bruno-'));
  const reportPath = path.join(reportDir, 'result.json');
  try {
    const bruCli = process.env.MOWRA_BRU_CLI;
    if (!bruCli) throw new Error('Bruno CLIのパスが設定されていません');
    const args = [bruCli, 'run', path.relative(collection, request), '--reporter-json', reportPath, '--reporter-skip-all-headers'];
    if (environment) args.push('--env', environment);
    const execution = await run(process.execPath, args, collection);
    let report = null;
    try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); } catch {}
    const payload = { ok: execution.code === 0, exitCode: execution.code, report, stdout: execution.stdout.slice(-4000), stderr: execution.stderr.slice(-4000) };
    return { isError: execution.code !== 0, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }] };
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true }).catch(() => {});
  }
});

await server.connect(new StdioServerTransport());
