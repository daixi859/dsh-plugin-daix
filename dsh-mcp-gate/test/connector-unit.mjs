// dsh-mcp-gate 连接器单测：纯函数 + stdio 真连接 + http 假服务器。
// 运行：node test/connector-unit.mjs
'use strict';
import { createConnection, connectServer, ndjsonSplit, parseSseEvents, extractRpcMessage, rpcErrorText, parseToolList } from "../lib/connector.js";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mini = path.join(here, "mini-mcp-server.js");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass += 1;
    console.log("  ok  " + name);
  } else {
    fail += 1;
    console.log("FAIL  " + name);
  }
}

const timeout = setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(1);
}, 30000);

// ── 1. 纯函数 ──
{
  const { lines, rest } = ndjsonSplit('{"a":1}\n{"b":2}\n{"c"');
  check("ndjson: two complete lines", lines.length === 2 && JSON.parse(lines[0]).a === 1);
  check("ndjson: partial rest", rest === '{"c"');
  const ev = parseSseEvents('event: message\ndata: {"x":1}\n\ndata: {"y":2}\n\n: comment\n');
  check("sse: two events", ev.length === 2 && ev[0].data === '{"x":1}' && ev[1].data === '{"y":2}');
  const multi = parseSseEvents("data: line1\ndata: line2\n\n");
  check("sse: multiline data joins", multi[0].data === "line1\nline2");
  const msg = extractRpcMessage(parseSseEvents('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n'));
  check("sse: rpc extracted", msg && msg.id === 1);
  check("rpc error text", rpcErrorText({ error: { message: "boom", data: "detail" } }) === "boom: detail");
  const tl = parseToolList({ result: { tools: [{ name: "a" }], nextCursor: "cur1" } });
  check("tools/list parse", tl.tools.length === 1 && tl.nextCursor === "cur1");
}

// ── 2. stdio 真连接 ──
{
  const conn = await connectServer({
    serverName: "demo",
    transport: "stdio",
    command: process.execPath,
    args: [mini],
  });
  check("stdio: connected", conn.status === "connected");
  check("stdio: 3 tools", conn.tools.length === 3 && conn.tools.some((t) => t.name === "echo"));
  const r = await conn.call("echo", { text: "hello-connector" });
  check("stdio: call echo", !r.isError && r.content[0].text === "echo: hello-connector");
  const sum = await conn.call("add", { a: 2, b: 40 });
  check("stdio: call add", sum.content[0].text === "42");
  conn.close();
  check("stdio: closed", conn.status === "closed");
}

// ── 3. http 假服务器（JSON 与 SSE 两种响应 + session id）──
{
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const msg = JSON.parse(body || "{}");
      const reply = (obj) => {
        const payload = JSON.stringify(obj);
        if (msg.method === "tools/list") {
          // SSE 形态响应
          res.writeHead(200, { "Content-Type": "text/event-stream", "Mcp-Session-Id": "sess-1" });
          res.end(`event: message\ndata: ${payload}\n\n`);
        } else {
          res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-1" });
          res.end(payload);
        }
      };
      if (msg.method === "initialize") {
        reply({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake-http", version: "0.1.0" } } });
      } else if (msg.method === "tools/list") {
        reply({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ping", description: "Pong.", inputSchema: { type: "object", properties: {} } }] } });
      } else if (msg.method === "tools/call") {
        check("http: session id sent", (req.headers["mcp-session-id"] || "") === "sess-1");
        reply({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "pong" }] } });
      } else {
        reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nope" } });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const conn = await connectServer({
    serverName: "fake",
    transport: "streamable-http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { Authorization: "Bearer test" },
  });
  check("http: connected via SSE list", conn.status === "connected" && conn.tools.length === 1 && conn.tools[0].name === "ping");
  if (conn.status !== "connected") console.log("  ..  http conn.status=" + conn.status + " error=" + JSON.stringify(conn.error));
  const r = await conn.call("ping", {});
  check("http: call → pong", r.content[0].text === "pong");
  conn.close();
  server.closeAllConnections?.();
  server.close();
}

// ── 4. 错误路径：连不上的端口 → status error（不抛）──
{
  const conn = await connectServer({
    serverName: "dead",
    transport: "streamable-http",
    url: "http://127.0.0.1:1/mcp", // port 1 不可连
  });
  check("http: dead port → error status", conn.status === "error" && /fetch|ECONNREFUSED|HTTP|timed out/i.test(conn.error || ""));
  conn.close();
}

// ── 5. 超时路径：响应永不到达 ──
{
  const conn = createConnection({ serverName: "slow", transport: "streamable-http", url: "http://127.0.0.1:9/mcp" });
  // 不 initialize，直接用内部 request 模拟慢服务器：用不可达端口触发 send 失败而非挂起。
  try {
    await conn.call("x", {}, 500);
    check("timeout: unreachable send rejects", false);
  } catch (err) {
    check("timeout: rejects quickly", /fetch|ECONNREFUSED|HTTP/i.test(String(err.message || err)));
  }
  conn.close();
}

clearTimeout(timeout);
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
