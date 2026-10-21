// dsh-mcp-gate 内置 MCP 连接器
// 运行时直连 MCP 服务器（stdio 子进程 / streamable-http），免重启管理。
// 协议：JSON-RPC 2.0；stdio = 换行分隔 JSON；http = POST + (JSON | SSE) 响应 + Mcp-Session-Id。
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "dsh-mcp-gate", version: "0.3.0" };
const LIST_TIMEOUT_MS = 30000;
const INIT_TIMEOUT_MS = 15000;

// ── 纯函数（单测覆盖）───────────────────────────────────────────────

/** 按行切缓冲，返回 {lines, rest}；最后无换行的残留进 rest。 */
export function ndjsonSplit(text) {
  const lines = String(text).split("\n");
  const rest = lines.pop() ?? "";
  return { lines: lines.filter((l) => l.trim() !== ""), rest };
}

/** 解析 SSE 文本为事件数组 [{event, data}]；data: 多行按 \n 拼接。 */
export function parseSseEvents(text) {
  const events = [];
  let cur = null;
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") {
      if (cur) {
        events.push(cur);
        cur = null;
      }
      continue;
    }
    if (line.startsWith(":")) continue;
    const m = line.match(/^(\w+):\s?(.*)$/);
    if (!m) continue;
    const [, field, value] = m;
    if (field === "event") {
      cur = cur || { event: "message", data: "" };
      cur.event = value;
    } else if (field === "data") {
      cur = cur || { event: "message", data: "" };
      cur.data += (cur.data ? "\n" : "") + value;
    }
  }
  if (cur) events.push(cur);
  return events;
}

/** 从 SSE 事件数组里取第一个能 JSON.parse 且带 jsonrpc 字段的消息。 */
export function extractRpcMessage(events) {
  for (const ev of events) {
    try {
      const msg = JSON.parse(ev.data);
      if (msg && typeof msg === "object" && ("jsonrpc" in msg || "result" in msg || "error" in msg)) return msg;
    } catch {}
  }
  return undefined;
}

/** JSON-RPC 错误结果 → 可读 Error 文本。 */
export function rpcErrorText(resp) {
  if (resp && resp.error) {
    const d = resp.error.data;
    const detail = typeof d === "string" ? `: ${d}` : d !== undefined ? `: ${JSON.stringify(d)}` : "";
    return `${resp.error.message ?? "MCP error"}${detail}`;
  }
  return "MCP error (no error field)";
}

/** 从 tools/list 响应提取 {tools, nextCursor}。 */
export function parseToolList(resp) {
  const result = resp && resp.result;
  const tools = Array.isArray(result && result.tools) ? result.tools : [];
  const nextCursor = result && typeof result.nextCursor === "string" ? result.nextCursor : undefined;
  return { tools, nextCursor };
}

/** 从 initialize 响应提取 session id（http transport 用响应头，此函数处理 result 兜底）。 */
export function parseInitResult(resp) {
  const result = resp && resp.result;
  return {
    serverInfo: (result && result.serverInfo) || {},
    capabilities: (result && result.capabilities) || {},
    // MCP 规范可选字段：服务器自我描述（一行用法说明），做 server 目录摘要的兜底
    instructions: typeof (result && result.instructions) === "string" ? result.instructions : "",
  };
}

// ── 传输层 ────────────────────────────────────────────────────────

/** stdio 子进程传输。 */
export function createStdioTransport(cfg, log) {
  // Windows 上 npx/uvx 等实为 .cmd 批处理脚本，spawn 不带 shell 会 ENOENT；
  // args 去控制字符防 shell 拼接注入。
  const args = (cfg.args || []).map((a) => String(a).replace(/[\r\n\0]/g, " "));
  const child = spawn(cfg.command, args, {
    cwd: cfg.cwd || undefined,
    env: { ...process.env, ...(cfg.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  });
  let stderrTail = "";
  let spawnError = null;
  const failFns = [];
  child.on("error", (err) => {
    // spawn 失败（ENOENT/EACCES 等）不监听会成为未捕获异常直接打崩宿主进程
    spawnError = `spawn "${cfg.command}" failed: ${err.message}`;
    log(`[stdio ${cfg.serverName}] ${spawnError}`);
    for (const fn of [...failFns]) {
      try {
        fn(spawnError);
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-8000);
    log(`[stdio ${cfg.serverName}] stderr: ${d.toString().trim().slice(0, 200)}`);
  });
  child.on("exit", (code, signal) => log(`[stdio ${cfg.serverName}] exited code=${code} signal=${signal}`));
  let buf = "";
  const transport = {
    kind: "stdio",
    close() {
      try {
        child.kill();
      } catch {}
    },
    onFail(fn) {
      failFns.push(fn);
      if (spawnError) fn(spawnError);
    },
    onMessage(fn) {
      child.stdout.on("data", (d) => {
        buf += d.toString();
        const { lines, rest } = ndjsonSplit(buf);
        buf = rest;
        for (const line of lines) {
          try {
            fn(JSON.parse(line));
          } catch {}
        }
      });
    },
    async send(msg) {
      if (spawnError) throw new Error(spawnError);
      child.stdin.write(JSON.stringify(msg) + "\n");
    },
    describe() {
      return `stdio ${cfg.command}${(cfg.args || []).length ? " " + (cfg.args || []).join(" ") : ""}`;
    },
    stderrTail: () => stderrTail,
  };
  return transport;
}

/** streamable-http 传输（POST + JSON 或 SSE 响应 + Mcp-Session-Id）。 */
export function createHttpTransport(cfg, log) {
  let sessionId = undefined;
  const headers = { ...(cfg.headers || {}) };
  const baseHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  const transport = {
    kind: "http",
    close() {},
    onMessage() {}, // http 无独立读循环，响应随请求返回
    async send(msg) {
      const reqHeaders = { ...baseHeaders };
      if (sessionId) reqHeaders["Mcp-Session-Id"] = sessionId;
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(msg),
      });
      const sid = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id");
      if (sid) sessionId = sid;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text();
      if (ctype.includes("text/event-stream")) {
        return extractRpcMessage(parseSseEvents(text));
      }
      if (text.trim() === "" || res.status === 202) return undefined; // 通知类响应
      try {
        return JSON.parse(text);
      } catch {
        // 某些服务器即便 JSON content-type 也回 SSE 文本
        return extractRpcMessage(parseSseEvents(text));
      }
    },
    describe() {
      return `http ${cfg.url}`;
    },
    stderrTail: () => "",
  };
  return transport;
}

// ── 连接（请求匹配 + initialize + tools/list）──────────────────────

export function createConnection(serverCfg, { debugLog = () => {} } = {}) {
  const log = (msg) => debugLog(`[conn ${serverCfg.serverName}] ${msg}`);
  const transport =
    serverCfg.transport === "stdio"
      ? createStdioTransport(serverCfg, log)
      : createHttpTransport(serverCfg, log);

  const pending = new Map();
  let nextId = 1;
  let closed = false;

  // stdio：响应从读循环进来；http：响应是 send() 的返回值——两条路都汇到这里。
  const handleIncoming = (msg) => {
    if (msg && typeof msg.id !== "undefined" && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(rpcErrorText(msg)));
      else p.resolve(msg);
    }
    // 通知/请求（服务端→客户端）v1 忽略
  };
  transport.onMessage(handleIncoming);

  function request(method, params, timeoutMs = LIST_TIMEOUT_MS) {
    if (closed) return Promise.reject(new Error("connection closed"));
    const id = nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      transport
        .send(msg)
        .then((resp) => {
          if (resp) handleIncoming(resp); // http 传输：响应随 send 返回
        })
        .catch((err) => {
          if (pending.has(id)) {
            clearTimeout(pending.get(id).timer);
            pending.delete(id);
            reject(err);
          }
        });
    });
  }

  async function listTools() {
    const all = [];
    let cursor = undefined;
    do {
      const resp = await request("tools/list", cursor ? { cursor } : {}, LIST_TIMEOUT_MS);
      const { tools, nextCursor } = parseToolList(resp);
      all.push(...tools);
      cursor = nextCursor;
    } while (cursor);
    return all;
  }

  const connection = {
    name: serverCfg.serverName,
    transport,
    status: "connecting",
    error: undefined,
    serverInfo: {},
    instructions: "",
    tools: [],
    async initialize() {
      try {
        const init = request(
          "initialize",
          { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
          INIT_TIMEOUT_MS
        );
        // spawn 失败（ENOENT 等）快速失败，不等超时
        if (transport.onFail) {
          const failed = new Promise((_, reject) => transport.onFail((msg) => reject(new Error(msg))));
          Object.assign(connection, parseInitResult(await Promise.race([init, failed])));
        } else {
          Object.assign(connection, parseInitResult(await init));
        }
        transport.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }).catch(() => {});
        connection.tools = await listTools();
        connection.status = "connected";
        connection.error = undefined;
        log(`initialized via ${transport.describe()}, ${connection.tools.length} tools`);
      } catch (err) {
        connection.status = "error";
        connection.error = String((err && err.message) || err);
        const tail = transport.stderrTail ? transport.stderrTail() : "";
        if (tail) connection.error = `${connection.error} | stderr: ${tail.trim().slice(-400)}`;
        log(`initialize failed: ${connection.error}`);
      }
      return connection;
    },
    async call(toolName, args, timeoutMs = 60000) {
      const resp = await request("tools/call", { name: toolName, arguments: args || {} }, timeoutMs);
      const result = resp && resp.result;
      const isError = !!(result && result.isError);
      const content = (result && Array.isArray(result.content) ? result.content : []).map((block) => {
        if (block && block.type === "text") return { type: "text", text: block.text };
        return { type: "text", text: JSON.stringify(block) };
      });
      return { isError, content, structuredContent: result && result.structuredContent };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("connection closed"));
      }
      pending.clear();
      transport.close();
      connection.status = "closed";
      log("closed");
    },
  };
  return connection;
}

/** 由 server 配置建立并初始化连接（不抛错：失败以 status:"error" 表达）。 */
export async function connectServer(serverCfg, opts) {
  const conn = createConnection(evalServerCfg(serverCfg), opts);
  return conn.initialize();
}

// ── !!js 表达式求值（config.json 是插件自读的 JSON，Loader 不会求值 !!js）──────

/** 求值单个 "!!js `...`" 字符串；普通值原样返回。 */
export function evalJsValue(value) {
  if (typeof value !== "string" || !value.startsWith("!!js ")) return value;
  let expr = value.slice(5).trim();
  if (expr.startsWith("'") && expr.endsWith("'")) expr = expr.slice(1, -1); // 去 yqScalar 包裹单引号
  try {
    return new Function("process", `"use strict"; return (${expr});`)(process);
  } catch (err) {
    throw new Error(`bad !!js expression (${String(expr).slice(0, 80)}): ${err && err.message}`);
  }
}

/** 对 server 配置里的 command/cwd/url/args/headers/env 做 !!js 求值（返回新对象）。 */
export function evalServerCfg(cfg) {
  const out = { ...cfg };
  for (const key of ["command", "cwd", "url"]) {
    if (typeof out[key] === "string") out[key] = evalJsValue(out[key]);
  }
  if (Array.isArray(out.args)) out.args = out.args.map((a) => evalJsValue(a));
  for (const mapKey of ["headers", "env"]) {
    if (out[mapKey] && typeof out[mapKey] === "object" && !Array.isArray(out[mapKey])) {
      const map = {};
      for (const [k, v] of Object.entries(out[mapKey])) map[k] = evalJsValue(v);
      out[mapKey] = map;
    }
  }
  return out;
}
