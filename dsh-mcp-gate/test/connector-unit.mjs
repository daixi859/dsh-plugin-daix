// dsh-mcp-gate 连接器单测：纯函数 + stdio 真连接 + http 假服务器。
// 运行：node test/connector-unit.mjs
'use strict';
import { createConnection, connectServer, ndjsonSplit, parseSseEvents, extractRpcMessage, rpcErrorText, parseToolList, decodeProcessOutput, evalServerCfg, expandEnvRefs } from "../lib/connector.js";
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

// ── 6. 启动失败快速失败 + stderr 解码（Windows shell:true 下命令不存在不会 ENOENT）──
{
  // GBK 字节（'npx' 不是内部或外部命令…）要解成中文，不能留一串 U+FFFD
  const gbk = Buffer.from([0x27, 0x6e, 0x70, 0x78, 0x27, 0x20, 0xb2, 0xbb, 0xca, 0xc7, 0xc4, 0xda, 0xb2, 0xbf, 0xbb, 0xf2, 0xcd, 0xe2, 0xb2, 0xbf, 0xc3, 0xfc, 0xc1, 0xee]);
  check("decode: gbk stderr → 中文", decodeProcessOutput(gbk) === "'npx' 不是内部或外部命令");
  check("decode: ascii untouched", decodeProcessOutput(Buffer.from("plain", "utf8")) === "plain");
  check("decode: empty", decodeProcessOutput(Buffer.alloc(0)) === "");

  const t0 = Date.now();
  const conn = await connectServer({ serverName: "missing", transport: "stdio", command: "definitely-not-a-real-command-xyz", args: [] });
  const elapsed = Date.now() - t0;
  check("stdio: missing command → error", conn.status === "error");
  // 回归防线：以前要干等 INIT_TIMEOUT_MS=15000 才报错
  check("stdio: missing command fails fast (<5000ms)", elapsed < 5000);
  check("stdio: error explains early exit", /before MCP handshake/.test(conn.error || ""));
  check("stdio: no mojibake in error", !(conn.error || "").includes("\uFFFD"));
  conn.close();
}

// ── 7. ${VAR} 引用展开（落盘存引用，连接时才取进程环境）──
{
  process.env.PROBE_TOKEN = "tok-abc-123";
  const cfg = evalServerCfg({
    transport: "streamable-http",
    url: "https://example.invalid/mcp",
    headers: { Authorization: "Bearer ${PROBE_TOKEN}" },
    env: { TOKEN: "${PROBE_TOKEN}", LITERAL: "plain" },
    args: ["--token", "${PROBE_TOKEN}"],
  });
  check("envref: header expanded", cfg.headers.Authorization === "Bearer tok-abc-123", cfg.headers.Authorization);
  check("envref: env expanded", cfg.env.TOKEN === "tok-abc-123");
  check("envref: args expanded", cfg.args[1] === "tok-abc-123");
  check("envref: literal untouched", cfg.env.LITERAL === "plain");
  check("envref: no ${ left", !JSON.stringify(cfg).includes("${"));
  check("envref: missing var silent for other strings", expandEnvRefs("no refs", "x") === "no refs");

  let threw = "";
  try {
    expandEnvRefs("${DEFINITELY_UNSET_VAR_XYZ}", "headers.Authorization");
  } catch (err) {
    threw = String(err.message || err);
  }
  check("envref: missing var throws", /env var "DEFINITELY_UNSET_VAR_XYZ" is not set/.test(threw), threw);
  check("envref: error names the field", /headers\.Authorization/.test(threw), threw);

  // 求值失败要变成 error 态连接，不能让 syncConnections 整轮炸掉
  const bad = await connectServer({
    serverName: "badcfg",
    transport: "streamable-http",
    url: "https://example.invalid/mcp",
    headers: { Authorization: "Bearer ${DEFINITELY_UNSET_VAR_XYZ}" },
  });
  check("envref: connectServer returns error status", bad.status === "error", bad.status);
  check("envref: error carried into connection", /DEFINITELY_UNSET_VAR_XYZ/.test(bad.error || ""), bad.error);
  delete process.env.PROBE_TOKEN;
}

clearTimeout(timeout);
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
