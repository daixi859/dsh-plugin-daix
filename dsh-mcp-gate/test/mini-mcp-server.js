// 最小 MCP stdio 服务器（零依赖）：dsh-mcp-gate 端到端验证用。
// 提供 3 个工具：echo / time_now / add。行分隔 JSON-RPC 2.0。
'use strict';

const tools = [
  {
    name: 'echo',
    description: 'Echo back the given text. Demo tool for mcp-gate verification.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
  },
  {
    name: 'time_now',
    description: 'Return the current server time in ISO 8601 format.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number', description: 'First addend' }, b: { type: 'number', description: 'Second addend' } },
      required: ['a', 'b'],
    },
  },
];

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo', version: '1.0.0' },
      },
    });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return; // 通知不回复
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    let text;
    if (name === 'echo') text = `echo: ${args.text}`;
    else if (name === 'time_now') text = new Date().toISOString();
    else if (name === 'add') text = String(Number(args.a || 0) + Number(args.b || 0));
    else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
}
