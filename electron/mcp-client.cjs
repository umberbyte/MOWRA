async function withStdioMcp(server, callback) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js')
  ]);
  const client = new Client({ name: 'mowra-desktop', version: '0.3.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    cwd: server.cwd,
    env: server.env,
    stderr: 'pipe',
    maxBufferSize: 20 * 1024 * 1024
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(-4000); });
  try {
    await client.connect(transport, { timeout: 30_000 });
    return await callback(client);
  } catch (error) {
    const detail = stderr.trim();
    throw new Error(detail ? `${error.message}\n${detail}` : error.message);
  } finally {
    await client.close().catch(() => {});
  }
}

function resultText(result) {
  return (result?.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}

module.exports = { withStdioMcp, resultText };
