// dsh-mcp-gate — host 面
//
// 目标：MCP 工具渐进式披露（按 pi coding-agent 的 exposure 模型）+ 运行时接入管理。
//
// 接入来源（v0.4 起，单一来源）：
//   内置连接器（lib/connector.js）：服务器清单在 config.json 的 servers[name].connector，
//   运行时直连（stdio 子进程 / streamable-http），工具动态注册/注销，免重启。
//   旧版 profile patch（@deepseek-ai/dsh-mcp-client）接入方式已移除。
// 工具名统一 `mcp__<serverName>__<rawName>`。
//
// 可见性控制：
//   exposure = direct   → 全量声明
//   exposure = deferred → 折叠（restrict 移除），agent 可调 mcp_search 检索解锁，
//                         命中后下一轮请求重新出现
//   exposure = hidden   → 折叠且不可检索
//
// 生效规则：enabled_eff = master && (project.enabled ?? global.enabled ?? true)
//   master   ：全局总开关（config.mcpEnabled，硬开关；false 时连接器全部断开）
//   global   ：~/.dsh/plugins/mcp-gate/config.json → servers[name].enabled/exposure/toolExposure/connector
//   project  ：<工作区>/.dsh/mcp-gate.json → servers[name].enabled（只写覆盖）
//
// 机制（practices.md 对齐）：per-agent 在 `agent/created`（串行）里
//   - agent.ctx.tools.register 注册 scope 级 mcp_search 工具 + 已连接服务器的全部工具
//   - agent.ctx.tools.restrict({ deny: [...] }) 折叠名单（restrict 只移除、
//     三对齐：呈现/查找/执行；unknown names fail → 名单每次从 schemas() 快照构建）
//   - 名单重建 = dispose 旧 restriction + 注册新名单（双 owner：effect 兜底）
//   - `tools/change`（UNFILTERED）触发所有活 agent 去抖重算
//   - 连接建立/重连后 syncGlobalTools() 把工具注册到全局 ctx（tools/change 触发存量 agent 重算）

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { connectServer } from "./connector.js";

export const name = "mcp-gate";
export const inject = ["tools", "timer", "workingDirectory", "systemPrompt"];

/** 无 tunable；占位以符合官方 Config 形态。 */
export const Config = undefined;

// ── 常量 ────────────────────────────────────────────────────────────────────

const MCP_PREFIX = "mcp__";
const SEARCH_TOOL = "mcp_search";
const EXPOSURES = ["direct", "deferred", "hidden"];
const DEFAULT_EXPOSURE = "deferred";

const DEBUG = process.env.MCP_GATE_DEBUG === "1";

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    const path = join(dshHome(), "plugins", "mcp-gate", "debug.log");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, new Date().toISOString() + " " + msg + "\n");
  } catch {}
}

// ── 路径与配置 ──────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), ".dsh");
}

function configPath() {
  return join(dshHome(), "plugins", "mcp-gate", "config.json");
}

function projectConfigPath(cwd) {
  return join(cwd, ".dsh", "mcp-gate.json");
}

/** 路径键：Windows 大小写/分隔符不敏感的匹配键。 */
function pathKey(p) {
  return String(p || "").replace(/\//g, "\\").toLowerCase();
}

const DEFAULT_GLOBAL = () => ({ mcpEnabled: true, servers: {} });

/** 深拷贝 + 白名单清洗，保证落盘形状稳定。 */
function sanitizeGlobal(raw) {
  const out = DEFAULT_GLOBAL();
  if (raw && typeof raw === "object") {
    out.mcpEnabled = raw.mcpEnabled !== false;
    if (raw.servers && typeof raw.servers === "object") {
      for (const [server, entry] of Object.entries(raw.servers)) {
        if (!entry || typeof entry !== "object") continue;
        const clean = {};
        if (typeof entry.enabled === "boolean") clean.enabled = entry.enabled;
        // 一行服务器描述：进 system prompt 目录 + 参与检索排名（pi 的 mcp_servers section 同款）
        if (typeof entry.description === "string" && entry.description.trim()) {
          clean.description = entry.description.trim().slice(0, 250);
        }
        if (EXPOSURES.includes(entry.exposure)) clean.exposure = entry.exposure;
        if (entry.toolExposure && typeof entry.toolExposure === "object") {
          const te = {};
          for (const [tool, ex] of Object.entries(entry.toolExposure)) {
            if (EXPOSURES.includes(ex)) te[tool] = ex;
          }
          if (Object.keys(te).length > 0) clean.toolExposure = te;
        }
        const conn = sanitizeConnector(entry.connector);
        if (conn) clean.connector = conn;
        out.servers[server] = clean;
      }
    }
  }
  return out;
}

/** 连接器配置白名单清洗；非法（无 transport 要素）返回 undefined。 */
function sanitizeConnector(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const transport = raw.transport === "streamable-http" ? "streamable-http" : "stdio";
  const out = { transport };
  if (transport === "streamable-http") {
    if (typeof raw.url !== "string" || !/^https?:\/\/.+/.test(raw.url)) return undefined;
    out.url = raw.url;
    if (raw.headers && typeof raw.headers === "object") {
      const h = {};
      for (const [k, v] of Object.entries(raw.headers)) {
        if (typeof k === "string" && k.trim() && v != null) h[k.trim()] = String(v);
      }
      if (Object.keys(h).length > 0) out.headers = h;
    }
  } else {
    if (typeof raw.command !== "string" || raw.command.trim().length === 0) return undefined;
    out.command = raw.command.trim();
    if (Array.isArray(raw.args)) out.args = raw.args.map((a) => String(a));
    if (raw.env && typeof raw.env === "object") {
      const e = {};
      for (const [k, v] of Object.entries(raw.env)) {
        if (typeof k === "string" && k.trim() && v != null) e[k.trim()] = String(v);
      }
      if (Object.keys(e).length > 0) out.env = e;
    }
    if (typeof raw.cwd === "string" && raw.cwd.trim()) out.cwd = raw.cwd.trim();
  }
  return out;
}

function sanitizeProject(raw) {
  const out = { servers: {} };
  if (raw && typeof raw === "object" && raw.servers && typeof raw.servers === "object") {
    for (const [server, entry] of Object.entries(raw.servers)) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.enabled === "boolean") {
        out.servers[server] = { enabled: entry.enabled };
      }
    }
  }
  return out;
}

async function readJson(path, fallback) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ── BM25（Okapi，k1=1.2 b=0.75，参照 pi tool-search）────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "and", "or", "in", "on", "with", "by",
  "is", "are", "be", "this", "that", "it", "as", "at", "from", "list", "get", "set",
]);

function stem(w) {
  if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  const out = [];
  const parts = String(text || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/);
  for (const part of parts) {
    const w = part.toLowerCase();
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** 参数 schema 的可检索文本：属性名 + 属性描述。 */
function schemaText(schema) {
  try {
    const props = schema && schema.parameters && schema.parameters.properties;
    if (!props || typeof props !== "object") return "";
    return Object.entries(props)
      .map(([key, value]) => key + " " + (value && value.description ? value.description : ""))
      .join(" ");
  } catch {
    return "";
  }
}

class ToolIndex {
  /** tools: [{ name, description, paramText }] —— 仅可检索（折叠中）的工具。 */
  constructor(tools) {
    this.docs = tools.map((tool) => {
      const tokens = tokenize(
        tool.name.replace(/__/g, " ") + " " + tool.description + " " + (tool.paramText || ""),
      );
      const tf = new Map();
      for (const w of tokens) tf.set(w, (tf.get(w) || 0) + 1);
      return { tool, tf, len: tokens.length || 1 };
    });
    this.df = new Map();
    for (const doc of this.docs) {
      for (const w of doc.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
    }
    this.avgLen = this.docs.reduce((sum, doc) => sum + doc.len, 0) / (this.docs.length || 1);
  }

  search(query, topK) {
    const terms = tokenize(query);
    if (terms.length === 0 || this.docs.length === 0) return [];
    const k1 = 1.2;
    const b = 0.75;
    const n = this.docs.length;
    const scores = new Map();
    for (const term of terms) {
      const df = this.df.get(term) || 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const doc of this.docs) {
        const f = doc.tf.get(term) || 0;
        if (f === 0) continue;
        const norm = f + k1 * (1 - b + (b * doc.len) / this.avgLen);
        scores.set(doc, (scores.get(doc) || 0) + (idf * (f * (k1 + 1))) / norm);
      }
    }
    return [...scores.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, topK)
      .map(([doc, score]) => ({ name: doc.tool.name, description: doc.tool.description, score }));
  }
}

const EMPTY_INDEX = new ToolIndex([]);

// ── 工具名解析 ──────────────────────────────────────────────────────────────

/** `mcp__<server>__<raw...>` → { server, raw }；不合式时 server=rest, raw=rest。 */
function splitToolName(name) {
  const rest = name.slice(MCP_PREFIX.length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return { server: rest, raw: rest };
  return { server: rest.slice(0, idx), raw: rest.slice(idx + 2) };
}

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx) {
  debugLog("apply mcp-gate");
  /** agentId → state（cwd、projectServers、unlocked、restrictDisposer、index、timer） */
  const states = new Map();
  let globalConfig = DEFAULT_GLOBAL();

  async function loadGlobalConfig() {
    return sanitizeGlobal(await readJson(configPath(), DEFAULT_GLOBAL()));
  }

  async function saveGlobalConfig() {
    await writeJson(configPath(), globalConfig);
  }

  async function loadProjectOverrides(cwd) {
    if (!cwd) return { servers: {} };
    return sanitizeProject(await readJson(projectConfigPath(cwd), { servers: {} }));
  }

  // ── 生效计算 ──

  function globalEntry(server) {
    const entry = globalConfig.servers[server];
    return entry && typeof entry === "object" ? entry : {};
  }

  function effectiveExposure(server) {
    const entry = globalEntry(server);
    return EXPOSURES.includes(entry.exposure) ? entry.exposure : DEFAULT_EXPOSURE;
  }

  /** master && (project ?? global ?? true)。 */
  function effectiveEnabled(server, projectServers) {
    if (globalConfig.mcpEnabled === false) return false;
    const g = globalEntry(server);
    const p = projectServers[server];
    if (p && typeof p.enabled === "boolean") return p.enabled;
    if (typeof g.enabled === "boolean") return g.enabled;
    return true;
  }

  /** 单工具可见性：enabled && (server direct || per-tool direct || 已解锁)。 */
  function isVisible(toolName, raw, server, unlocked, projectServers) {
    if (!effectiveEnabled(server, projectServers)) return false;
    const exposure = effectiveExposure(server);
    if (exposure === "hidden") return false;
    if (exposure === "direct") return true;
    const entry = globalEntry(server);
    const perTool = entry.toolExposure && entry.toolExposure[raw];
    if (perTool === "direct") return true;
    if (perTool === "hidden") return false;
    return unlocked.has(toolName);
  }

  // ── per-agent 重算 ──

  function disposeRestrict(state) {
    if (state.restrictDisposer) {
      const dispose = state.restrictDisposer;
      state.restrictDisposer = null;
      try {
        dispose();
      } catch {}
    }
  }

  function schedule(state) {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = 0;
      recompute(state);
    }, 30);
  }

  async function recompute(state) {
    // 互斥：tools/change 高频触发时避免并发交错（await 读盘期间又进来一个）。
    if (state.busy) {
      state.pending = true;
      return;
    }
    state.busy = true;
    try {
      await recomputeInner(state);
    } finally {
      state.busy = false;
      if (state.pending) {
        state.pending = false;
        recompute(state);
      }
    }
  }

  async function recomputeInner(state) {
    const { agent } = state;
    // cwd/项目覆盖懒解析：agent/created 时刻目录常未分配（get/ensure 都返回空），
    // 失败则 500ms 后重试，拿到真实 cwd 后项目覆盖才会生效。
    if (!state.cwd) {
      state.cwd = await resolveAgentCwd(agent);
      debugLog(
        `resolved cwd=${state.cwd || "?"} agent=${agent.id}` +
          (state.cwdRetries ? ` retry=${state.cwdRetries}` : ""),
      );
      if (!state.cwd) {
        state.cwdRetries += 1;
        if (state.cwdRetries <= 12) {
          if (state.cwdTimer) state.cwdTimer();
          state.cwdTimer = ctx.timer.timeout(() => {
            state.cwdTimer = null;
            recompute(state);
          }, 500);
        }
      }
    }
    let schemas;
    try {
      schemas = agent.ctx.tools.schemas();
    } catch {
      return;
    }
    // 项目覆盖每次重读（UI POST 后落盘，agent 侧无需失效通知）。
    state.projectServers = (await loadProjectOverrides(state.cwd)).servers;

    const mcpTools = schemas.filter(
      (tool) => typeof tool.name === "string" && tool.name.startsWith(MCP_PREFIX),
    );
    const serverSummaries = new Map(); // server → 检索增强文本（每轮每 server 只算一次）
    debugLog(`recompute agent=${agent.id} schemas=${schemas.length} mcp=${mcpTools.length}`);
    if (mcpTools.length === 0) {
      state.index = EMPTY_INDEX;
      if (state.lastDenyKey) {
        state.lastDenyKey = "";
        disposeRestrict(state);
      }
      return;
    }

    const deny = [];
    const searchable = [];
    for (const tool of mcpTools) {
      const { server, raw } = splitToolName(tool.name);
      if (!serverSummaries.has(server)) serverSummaries.set(server, serverSearchBoost(server));
      if (isVisible(tool.name, raw, server, state.unlocked, state.projectServers)) continue;
      deny.push(tool.name);
      // hidden / 禁用 → 不可检索；deferred → 可检索。
      if (
        effectiveEnabled(server, state.projectServers) &&
        effectiveExposure(server) !== "hidden" &&
        globalEntry(server).toolExposure?.[raw] !== "hidden"
      ) {
        searchable.push({
          name: tool.name,
          description: (typeof tool.description === "string" ? tool.description : "") + (serverSummaries.get(server) || ""),
          paramText: schemaText(tool),
        });
      }
    }

    state.index = searchable.length > 0 ? new ToolIndex(searchable) : EMPTY_INDEX;

    // 幂等短路：deny 名单没变就不动 restrict。restrict 的注册/注销本身会再发
    // tools/change，没有这个短路会 dispose↔restrict 死循环。
    const denyKey = deny.slice().sort().join("\n");
    if (denyKey === state.lastDenyKey) return;
    state.lastDenyKey = denyKey;
    disposeRestrict(state);

    if (deny.length > 0) {
      try {
        state.restrictDisposer = agent.ctx.tools.restrict({ deny });
        debugLog(`restrict agent=${agent.id} deny=[${deny.join(",")}]`);
      } catch (error) {
        // unknown-name 竞态（注册并发变化）：丢弃，等下一次 tools/change 重算。
        state.restrictDisposer = null;
        state.lastDenyKey = "";
        debugLog(`restrict agent=${agent.id} failed: ${error && error.message}`);
      }
    }
  }

  function recomputeAll() {
    refreshServersSection();
    for (const state of states.values()) schedule(state);
  }

  // ── system prompt server 目录（catalog 层：模型先看目录再检索，盲搜变精准搜索）──

  const SECTION_NAME = "mcp-gate:servers";
  let sectionDisposer = null;
  let lastSectionText = null;

  /** 该 server 的全局可见工具名列表：连接器池优先，否则从全局 schema 快照过滤。 */
  function globalServerToolNames(server) {
    const p = pool.get(server);
    if (p && p.conn && Array.isArray(p.conn.tools) && p.conn.tools.length > 0) {
      return p.conn.tools.map((t) => t.name);
    }
    try {
      return ctx.tools
        .schemas()
        .filter((t) => t.name.startsWith(`${MCP_PREFIX}${server}__`))
        .map((t) => splitToolName(t.name).raw);
    } catch {
      return [];
    }
  }

  /** 一行服务器摘要：配置描述 → 服务器 initialize.instructions 首行 → 工具名聚合。 */
  function serverSummaryOf(name) {
    const entry = globalConfig.servers[name] || {};
    if (entry.description) return entry.description;
    const p = pool.get(name);
    if (p && p.conn && p.conn.instructions) {
      return p.conn.instructions.split("\n", 1)[0].trim().slice(0, 250);
    }
    const names = globalServerToolNames(name);
    if (names.length === 0) return "";
    return names.slice(0, 8).join(", ") + (names.length > 8 ? `, +${names.length - 8} more` : "");
  }

  /** 检索文档的 server 语义增强（只拼描述类文本，工具名聚合会污染 BM25）。 */
  function serverSearchBoost(name) {
    const entry = globalConfig.servers[name] || {};
    if (entry.description) return ` [server ${name}: ${entry.description}]`;
    const p = pool.get(name);
    if (p && p.conn && p.conn.instructions) {
      return ` [server ${name}: ${p.conn.instructions.split("\n", 1)[0].trim().slice(0, 120)}]`;
    }
    return ` [server ${name}]`;
  }

  function buildServersSectionText() {
    if (globalConfig.mcpEnabled === false) return "";
    const lines = [];
    for (const name of Object.keys(globalConfig.servers).sort()) {
      const entry = globalConfig.servers[name];
      if (!entry || entry.enabled === false) continue;
      if ((entry.exposure || DEFAULT_EXPOSURE) === "hidden") continue;
      const count = globalServerToolNames(name).length;
      if (count === 0) continue;
      const summary = serverSummaryOf(name);
      lines.push(`- ${name} (${count} tool${count === 1 ? "" : "s"})${summary ? `: ${summary}` : ""}`);
    }
    if (lines.length === 0) return "";
    return (
      "MCP servers — their tools are collapsed to save context and none are loaded yet.\n" +
      "When a task could use one of these, search with mcp_search(query) first; matched tools become callable from your next message.\n" +
      lines.join("\n")
    );
  }

  /** 文本变化才重注册（幂等；section 变化低频，cache 代价可接受）。 */
  function refreshServersSection() {
    const text = buildServersSectionText();
    if (text === lastSectionText) return;
    lastSectionText = text;
    if (sectionDisposer) {
      try { sectionDisposer(); } catch {}
      sectionDisposer = null;
    }
    if (!text) return;
    try {
      sectionDisposer = ctx.systemPrompt.section({ name: SECTION_NAME, order: 900, text });
      debugLog(`prompt section updated: ${text.split("\n").length - 2} server(s)`);
    } catch (error) {
      sectionDisposer = null;
      debugLog(`prompt section failed: ${error && error.message}`);
    }
  }

  // ── 内置连接器：连接池 + 动态工具注册 ─────────────────────────────────────

  /** serverName → { conn, cfgKey }。cfgKey 变化即重连。 */
  const pool = new Map();
  let syncing = null; // 串行化 syncConnections

  function cfgKeyOf(cfg) {
    return JSON.stringify(cfg);
  }

  /** master && 全局 enabled（项目覆盖不参与连接决策，只影响可见性）。 */
  function wantsConnection(name) {
    if (globalConfig.mcpEnabled === false) return false;
    const entry = globalConfig.servers[name];
    if (!entry || !entry.connector) return false;
    return entry.enabled !== false;
  }

  /** 使连接池收敛到配置期望；对每个活 agent 同步工具集；触发重算。 */
  function syncConnections() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const want = new Map();
        for (const name of Object.keys(globalConfig.servers)) {
          if (wantsConnection(name)) want.set(name, globalConfig.servers[name].connector);
        }
        for (const [name, p] of [...pool]) {
          if (!want.has(name) || cfgKeyOf(want.get(name)) !== p.cfgKey) {
            p.conn.close();
            pool.delete(name);
            debugLog(`conn ${name}: closed (config changed or removed)`);
          }
        }
        for (const [name, cfg] of want) {
          if (pool.has(name)) continue;
          const conn = await connectServer({ ...cfg, serverName: name }, { debugLog });
          pool.set(name, { conn, cfgKey: cfgKeyOf(cfg) });
          debugLog(`conn ${name}: ${conn.status} via ${conn.transport.describe()} tools=${conn.tools.length}${conn.error ? " error=" + conn.error : ""}`);
        }
      } finally {
        syncing = null;
      }
      syncGlobalTools();
      recomputeAll();
    })();
    return syncing;
  }

  /** MCP inputSchema → dsh parameters（保证 object-rooted）。 */
  function toParameters(inputSchema) {
    if (inputSchema && typeof inputSchema === "object" && inputSchema.type === "object") {
      return inputSchema;
    }
    return { type: "object", properties: {} };
  }

  /** MCP tools/call 结果 → dsh output render 文本。 */
  function renderCallValue(value) {
    if (value && Array.isArray(value.content)) {
      const text = value.content
        .map((block) => (block && block.type === "text" && typeof block.text === "string" ? block.text : JSON.stringify(block)))
        .filter((t) => t.length > 0)
        .join("\n");
      if (text.length > 0) return text;
    }
    return JSON.stringify(value ?? null);
  }

  function makeRemoteTool(conn, tool) {
    const name = `${MCP_PREFIX}${conn.name}__${tool.name}`;
    const description = String(tool.description || tool.name);
    return {
      name,
      description,
      parameters: toParameters(tool.inputSchema),
      output: {
        schema: { type: "object" },
        render: (_args, value) => [{ type: "text", text: renderCallValue(value) }],
      },
      async execute(args) {
        const p = pool.get(conn.name);
        if (!p || p.conn.status !== "connected") {
          throw new Error(`MCP server "${conn.name}" is not connected (status: ${p ? p.conn.status : "removed"})`);
        }
        const result = await p.conn.call(tool.name, args);
        if (result.isError) {
          throw new Error(renderCallValue(result));
        }
        // 只回已定义字段：框架对 value 做 lossless JSON 校验，undefined 字段会被拒
        const value = { content: result.content };
        if (result.structuredContent !== undefined) value.structuredContent = result.structuredContent;
        return value;
      },
    };
  }

  // 连接器工具注册到全局 ctx（继承面）：
  // - agent scope 注册的工具不进 schemas() 快照，restrict 也折叠不了它们（只作用于继承面）；
  // - 全局注册后各 agent 经 tools/change 触发 recompute，折叠与检索才能生效。
  const globalTools = new Map(); // toolName → disposer（null = 注册失败已处理，防反复重试）

  /** 幂等：把池内已连接服务器的工具集与全局注册对齐（增/删）。 */
  function syncGlobalTools() {
    if (!ctx.tools || typeof ctx.tools.register !== "function") return;
    const want = new Map(); // toolName → { conn, tool }
    for (const [serverName, p] of pool) {
      if (p.conn.status !== "connected") continue;
      for (const tool of p.conn.tools) {
        if (tool && typeof tool.name === "string") {
          want.set(`${MCP_PREFIX}${serverName}__${tool.name}`, { conn: p.conn, tool });
        }
      }
    }
    for (const [toolName, dispose] of [...globalTools]) {
      if (!want.has(toolName)) {
        if (dispose) {
          try {
            dispose();
          } catch {}
        }
        globalTools.delete(toolName);
      }
    }
    for (const [toolName, { conn, tool }] of want) {
      if (globalTools.has(toolName)) continue;
      try {
        globalTools.set(toolName, ctx.tools.register(makeRemoteTool(conn, tool)));
        debugLog(`global register ${toolName}`);
      } catch (error) {
        // 同名工具已存在（重复注册）：标记已处理，不影响别的工具
        debugLog(`global register ${toolName} failed: ${error && error.message}`);
        globalTools.set(toolName, null); // 防止反复重试刷日志
      }
    }
  }

  // ── mcp_search 工具（scope 级）──

  function makeSearchTool(state) {
    return {
      name: SEARCH_TOOL,
      description:
        "Search deferred MCP tools by keyword and load the best matches into this session. " +
        "MCP tools are not listed up front to save context; the available MCP servers and their " +
        "capabilities are listed in the system prompt (MCP servers section). Call this whenever a " +
        "task might benefit from an external integration. " +
        "Matched tools become callable from your next message.",
      // 注意：register() 不编译 parameters（defineTool() 才编译 per-key spec），
      // 裸注册必须直接给 object-rooted JSON Schema，否则呈现层拿到非法形状、
      // 模型传参会被整包丢弃（症状：execute 收到 {}）。
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Keywords for the capability you need, e.g. 'pull request create' or 'issue search'.",
          },
          limit: {
            type: "number",
            description: "Maximum number of tools to load (1-20, default 8).",
          },
        },
        required: ["query"],
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: {
              type: "string",
              description:
                "Loaded tool list with one-line descriptions, or an explanation when nothing matched.",
            },
            count: {
              type: "integer",
              description: "Number of tools loaded this call.",
            },
          },
        },
        render: (_args, value) => [
          { type: "text", text: String(value && value.text ? value.text : "") },
        ],
      },
      async execute(args) {
        if (globalConfig.mcpEnabled === false) {
          return {
            text: "MCP is currently disabled by configuration (master switch). No tools to load.",
            count: 0,
          };
        }
        const query = String(args && args.query ? args.query : "").trim();
        if (query.length === 0) {
          return { text: "Empty query. Provide keywords for the capability you need.", count: 0 };
        }
        const limit = Math.min(Math.max(Number(args && args.limit) || 8, 1), 20);
        const hits = state.index.search(query, limit);
        if (hits.length === 0) {
          return {
            text: `No deferred MCP tools matched "${query}". Try broader keywords, or the integration may be disabled for this project.`,
            count: 0,
          };
        }
        for (const hit of hits) state.unlocked.add(hit.name);
        schedule(state);
        const lines = hits.map((hit) => `- ${hit.name}: ${hit.description}`);
        return {
          text:
            `Loaded ${hits.length} tools. They become available from your next message:\n` +
            lines.join("\n"),
          count: hits.length,
        };
      },
    };
  }

  // ── agent/created：per-agent 初始化（串行监听，setup 语义）──

  function onAgentCreated(handle) {
    // 事件可能给 AgentHandle{agent, dispose()} 或 agent 实例——两者都解。
    const agent = handle && handle.agent && handle.agent.ctx ? handle.agent : handle;
    debugLog(`agent/created id=${agent && agent.id}`);
    let agentCtx;
    try {
      agentCtx = agent.ctx;
    } catch {
      return;
    }
    if (!agentCtx || typeof agentCtx.tools?.restrict !== "function") {
      debugLog("agent/created: no agent ctx or tools.restrict — skip");
      return;
    }

    const state = {
      agent,
      agentCtx,
      cwd: null,
      cwdRetries: 0,
      cwdTimer: null,
      projectServers: {},
      unlocked: new Set(),
      restrictDisposer: null,
      index: EMPTY_INDEX,
      timer: 0,
      lastDenyKey: "",
    };
    states.set(agent.id, state);

    // 同步先行：register 必须发生在任何 await 之前，否则首个 prompt 组装
    // （串行 await agent/created）看不到工具。cwd/项目覆盖懒解析，由 recompute 补上。
    try {
      agentCtx.tools.register(makeSearchTool(state));
      debugLog(`registered ${SEARCH_TOOL} for agent ${agent.id}`);
    } catch (error) {
      debugLog(`register ${SEARCH_TOOL} failed: ${error && error.message}`);
    }
    // 连接器工具全局注册（syncGlobalTools，apply 时启动连接后对账）；
    // mcp_search 是 per-agent scope 工具（绑定各自 state）。

    // 双 owner：运行中重建 restrict（dispose 旧 + 注册新），effect 兜底最终清理。
    agentCtx.effect(
      () => () => {
        disposeRestrict(state);
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = 0;
        }
        if (state.cwdTimer) {
          state.cwdTimer();
          state.cwdTimer = null;
        }
        states.delete(agent.id);
      },
      "mcp-gate: agent scope",
    );

    schedule(state);
  }

  async function resolveAgentCwd(agent) {
    const wd = ctx.get("workingDirectory");
    if (!wd) {
      debugLog("wd: service missing");
      return null;
    }
    try {
      if (typeof wd.get === "function") {
        const got = wd.get(agent);
        debugLog(`wd.get -> ${JSON.stringify(got)}`);
        if (typeof got === "string" && got.length > 0) return got;
      } else {
        debugLog("wd.get: not a function");
      }
    } catch (error) {
      debugLog(`wd.get threw: ${error && error.message}`);
    }
    try {
      if (typeof wd.ensure === "function") {
        const ensured = await wd.ensure(agent);
        debugLog(`wd.ensure -> ${JSON.stringify(ensured)}`);
        if (typeof ensured === "string" && ensured.length > 0) return ensured;
      } else {
        debugLog("wd.ensure: not a function");
      }
    } catch (error) {
      debugLog(`wd.ensure threw: ${error && error.message}`);
    }
    debugLog(
      `wd.defaultDirectory -> ${JSON.stringify(wd.defaultDirectory)}` +
        ` keys=${Object.getOwnPropertyNames(wd).join(",")}`,
    );
    return null;
  }

  // ── 全局事件 ──

  const offCreated = ctx.on("agent/created", (agent) => {
    // 返回 promise：agent/created 串行监听语义要求 await，
    // 保证 mcp_search 注册与首轮 restrict 赶在首次 prompt assembly 之前。
    return onAgentCreated(agent);
  });
  const offChange = ctx.on("tools/change", () => recomputeAll());
  ctx.effect(
    () => () => {
      offCreated();
      offChange();
    },
    "mcp-gate: listeners",
  );

  // ── 服务器接入管理（config.json 的 servers[name].connector）──────────────
  //
  // add/update/remove 全部落到 config.json 并即时 syncConnections：
  //   新服务器立即连接、工具注册；删除立即断开；改 connector 立即重连。
  // 不写 profile patch，无需重启。
  //
  // connectorView(server) 把配置里的 connector 转成编辑面板预填视图（${ENV} 原样保留）。

  function normalizeServerInput(body) {
    const name = String(body && body.name ? body.name : "").trim();
    if (!SERVER_NAME_RE.test(name)) {
      throw new Error("server name must match [A-Za-z0-9_-]{1,32}");
    }
    const transport = body && body.transport === "streamable-http" ? "streamable-http" : "stdio";
    const server = { name, transport };
    if (transport === "streamable-http") {
      const url = String(body && body.url ? body.url : "").trim();
      if (!/^https?:\/\/.+/.test(url)) throw new Error("url must be an http(s) URL");
      server.url = url;
      server.headers = sanitizeStringMap(body && body.headers);
    } else {
      const command = String(body && body.command ? body.command : "").trim();
      if (command.length === 0) throw new Error("command is required for stdio servers");
      server.command = command;
      const rawArgs = body && body.args;
      if (typeof rawArgs === "string") {
        server.args = rawArgs.split(/\r?\n/).map((a) => a.trim()).filter((a) => a.length > 0);
      } else if (Array.isArray(rawArgs)) {
        server.args = rawArgs.map((a) => String(a));
      } else {
        server.args = [];
      }
      server.env = sanitizeStringMap(body && body.env);
      if (typeof (body && body.cwd) === "string" && body.cwd.trim().length > 0) {
        server.cwd = body.cwd.trim();
      }
    }
    return server;
  }

  function sanitizeStringMap(raw) {
    const out = {};
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof key === "string" && key.trim().length > 0 && value != null) {
          out[key.trim()] = String(value);
        }
      }
    }
    return out;
  }

  /** 编辑面板预填视图：config.json 里的 connector（${ENV} 引用原样保留，客户端直接回填）。 */
  function connectorView(server) {
    const connector = globalEntry(server).connector;
    if (!connector) return null;
    const view = {
      name: server,
      transport: connector.transport === "streamable-http" ? "streamable-http" : "stdio",
    };
    if (view.transport === "streamable-http") {
      view.url = connector.url || "";
      view.headers = { ...(connector.headers || {}) };
    } else {
      view.command = connector.command || "";
      view.args = Array.isArray(connector.args) ? connector.args.slice() : [];
      view.env = { ...(connector.env || {}) };
      if (connector.cwd) view.cwd = connector.cwd;
    }
    return view;
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body);
  }

  function readBody(req, maxBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  /** server 视图聚合：实际注册 ∪ 全局配置 ∪ 项目覆盖。 */
  function buildServerViews(rootSchemas, projectServers) {
    const live = new Map(); // server → [{ raw, name, description, paramText }]
    for (const tool of rootSchemas) {
      if (typeof tool.name !== "string" || !tool.name.startsWith(MCP_PREFIX)) continue;
      const { server, raw } = splitToolName(tool.name);
      if (!live.has(server)) live.set(server, []);
      live.get(server).push({
        raw,
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        paramText: schemaText(tool),
      });
    }
    const names = new Set([...live.keys(), ...Object.keys(globalConfig.servers)]);
    if (projectServers) for (const name of Object.keys(projectServers)) names.add(name);

    const servers = [];
    for (const server of [...names].sort()) {
      const tools = live.get(server) || [];
      const g = globalEntry(server);
      const p = projectServers ? projectServers[server] : undefined;
      const projectEnabled = p && typeof p.enabled === "boolean" ? p.enabled : null;
      const exposure = effectiveExposure(server);
      const enabled = effectiveEnabled(server, projectServers || {});
      const rows = tools.map((tool) => {
        const perTool = g.toolExposure && g.toolExposure[tool.raw];
        return {
          raw: tool.raw,
          name: tool.name,
          description: tool.description,
          exposure: perTool === "direct" ? "direct" : perTool === "hidden" ? "hidden" : exposure,
          overridden: perTool === "direct" || perTool === "hidden",
          deferred: !isVisible(tool.name, tool.raw, server, new Set(), projectServers || {}),
        };
      });
      const poolEntry = pool.get(server);
      const conn = poolEntry ? poolEntry.conn : undefined;
      servers.push({
        name: server,
        toolCount: tools.length,
        description: typeof g.description === "string" ? g.description : "",
        globalEnabled: typeof g.enabled === "boolean" ? g.enabled : true,
        exposure,
        toolExposure: g.toolExposure || {},
        projectEnabled,
        enabled,
        connector: connectorView(server),
        connectorMissing: !g.connector,
        editable: true,
        managed: Boolean(g.connector),
        connStatus: conn ? conn.status : "disconnected",
        connError: conn && conn.error ? conn.error : undefined,
        connTools: conn && conn.status === "connected" ? conn.tools.length : 0,
        tools: rows,
      });
    }
    return servers;
  }

  async function handleState(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const cwd = url.searchParams.get("cwd") || null;
      let rootSchemas = [];
      try {
        const tools = ctx.get("tools");
        rootSchemas = typeof tools?.schemas === "function" ? tools.schemas() : [];
      } catch {}
      const projectServers = cwd ? (await loadProjectOverrides(cwd)).servers : {};
      sendJson(res, 200, {
        ok: true,
        master: globalConfig.mcpEnabled !== false,
        workspacePath: cwd,
        servers: buildServerViews(rootSchemas, projectServers),
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleMaster(req, res) {
    try {
      const args = JSON.parse(await readBody(req));
      if (typeof args?.enabled !== "boolean") {
        sendJson(res, 400, { ok: false, error: "enabled must be boolean" });
        return;
      }
      globalConfig.mcpEnabled = args.enabled;
      await saveGlobalConfig();
      await syncConnections(); // master 关→全断；开→按配置重建
      recomputeAll();
      sendJson(res, 200, { ok: true, master: globalConfig.mcpEnabled });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleGlobal(req, res) {
    try {
      const args = JSON.parse(await readBody(req));
      const server = typeof args?.server === "string" ? args.server : null;
      if (!server) {
        sendJson(res, 400, { ok: false, error: "server required" });
        return;
      }
      const entry = { ...globalEntry(server) };
      if (typeof args.enabled === "boolean") entry.enabled = args.enabled;
      if (EXPOSURES.includes(args.exposure)) entry.exposure = args.exposure;
      if (typeof args.tool === "string" && args.tool.length > 0) {
        const te = { ...(entry.toolExposure || {}) };
        if (EXPOSURES.includes(args.toolExposure)) te[args.tool] = args.toolExposure;
        else delete te[args.tool];
        if (Object.keys(te).length > 0) entry.toolExposure = te;
        else delete entry.toolExposure;
      }
      if (Object.keys(entry).length === 0) delete globalConfig.servers[server];
      else globalConfig.servers[server] = entry;
      await saveGlobalConfig();
      recomputeAll();
      sendJson(res, 200, { ok: true, server, entry });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleProject(req, res) {
    try {
      const args = JSON.parse(await readBody(req));
      const cwd = typeof args?.cwd === "string" && args.cwd.length > 0 ? args.cwd : null;
      const server = typeof args?.server === "string" ? args.server : null;
      const enabled = args?.enabled;
      if (!cwd || !server || !(enabled === null || typeof enabled === "boolean")) {
        sendJson(res, 400, {
          ok: false,
          error: "cwd, server, enabled(true|false|null) required",
        });
        return;
      }
      const project = await loadProjectOverrides(cwd);
      if (enabled === null) delete project.servers[server];
      else project.servers[server] = { enabled };
      await writeJson(projectConfigPath(cwd), project);
      recomputeAll();
      sendJson(res, 200, { ok: true, cwd, server, enabled });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  /** 现有服务器名全集：config.json ∪ live 工具前缀。 */
  function collectServerNames() {
    const names = new Set(Object.keys(globalConfig.servers));
    try {
      const tools = ctx.get("tools");
      for (const t of (tools && tools.schemas ? tools.schemas() : [])) {
        if (typeof t.name === "string" && t.name.startsWith(MCP_PREFIX)) {
          names.add(splitToolName(t.name).server);
        }
      }
    } catch {}
    return names;
  }

  /** 粘贴 JSON 解析：兼容 {"mcpServers": {...}}（Claude Code / Cursor 约定）与直接 {name: {...}}。 */
  function parseMcpServersJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    let map = parsed;
    if (parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)) {
      map = parsed.mcpServers;
    }
    const keys = Object.keys(map);
    if (keys.length === 0) throw new Error('no servers found (expected {"mcpServers": {...}})');
    // 直接顶层对象若自身就是 server 体（有 command/url）而没有名字，无法导入
    if (keys.every((k) => ["command", "url", "args", "env", "type", "description"].includes(k))) {
      throw new Error("servers must be keyed by name: {\"mcpServers\": {\"<name>\": {...}}}");
    }
    return map;
  }

  /** 业界 mcpServers 条目 → normalizeServerInput 输入。stdio 看 command，http 看 url；type:"sse" 按 http 导入并在结果中警告。 */
  function fromImportedEntry(name, spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error("entry must be an object");
    }
    const type = typeof spec.type === "string" ? spec.type.toLowerCase() : "";
    const out = { name };
    if (typeof spec.description === "string") out.description = spec.description;
    if (spec.command) {
      out.transport = "stdio";
      out.command = spec.command;
      out.args = spec.args;
      out.env = spec.env;
      if (typeof spec.cwd === "string") out.cwd = spec.cwd;
    } else if (spec.url) {
      out.transport = "streamable-http";
      out.url = spec.url;
      out.headers = spec.headers;
    } else {
      throw new Error("entry needs command (stdio) or url (http)");
    }
    if (type === "sse") out.sseWarning = true;
    return out;
  }

  /** POST /import {json: "<粘贴文本>"}：批量导入 mcpServers JSON，重名跳过，单项失败不中断。 */
  async function handleImport(req, res) {
    try {
      const body = JSON.parse(await readBody(req));
      const text = typeof body?.json === "string" ? body.json : "";
      if (!text.trim()) throw new Error("json text required");
      const map = parseMcpServersJson(text);
      const names = collectServerNames();
      const added = [];
      const skipped = [];
      const failed = [];
      const sseWarnings = [];
      for (const [name, spec] of Object.entries(map)) {
        try {
          if (names.has(name)) {
            skipped.push({ name, reason: "name already in use" });
            continue;
          }
          const input = fromImportedEntry(String(name).trim(), spec);
          const server = normalizeServerInput(input);
          const { name: n, ...connector } = server;
          const entry = { enabled: true, connector };
          if (typeof input.description === "string" && input.description.trim()) {
            entry.description = input.description.trim().slice(0, 250);
          }
          globalConfig.servers[n] = entry;
          names.add(n);
          added.push(n);
          if (input.sseWarning) sseWarnings.push(n);
        } catch (error) {
          failed.push({ name, error: String(error && error.message ? error.message : error) });
        }
      }
      if (added.length > 0) {
        await saveGlobalConfig();
        await syncConnections();
        recomputeAll();
      }
      const connections = {};
      for (const n of added) {
        const p = pool.get(n);
        connections[n] = p
          ? { status: p.conn.status, tools: p.conn.status === "connected" ? p.conn.tools.length : 0, error: p.conn.error || null }
          : null;
      }
      sendJson(res, 200, { ok: true, added, skipped, failed, sseWarnings, connections });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  async function handleAdd(req, res) {
    try {
      const raw = JSON.parse(await readBody(req));
      const server = normalizeServerInput(raw);
      const names = collectServerNames();
      if (names.has(server.name)) {
        throw new Error(`server name "${server.name}" is already in use`);
      }
      const { name, ...connector } = server;
      const newEntry = { enabled: true, connector };
      // 一行描述：目录段 + 检索增强（空串/缺省 → 不写字段）
      const desc = typeof raw.description === "string" ? raw.description.trim().slice(0, 250) : "";
      if (desc) newEntry.description = desc;
      globalConfig.servers[name] = newEntry;
      await saveGlobalConfig();
      await syncConnections();
      const p = pool.get(name);
      recomputeAll();
      sendJson(res, 200, {
        ok: true,
        server: name,
        applied: "live",
        status: p ? p.conn.status : "connecting",
        tools: p && p.conn.status === "connected" ? p.conn.tools.length : 0,
        note:
          p && p.conn.status === "connected"
            ? `connected immediately, ${p.conn.tools.length} tools available`
            : `connection failed or pending: ${p && p.conn.error ? p.conn.error : "connecting"}`,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleUpdate(req, res) {
    try {
      const raw = JSON.parse(await readBody(req));
      const server = normalizeServerInput(raw);
      const { name, ...connector } = server;
      const entry = globalConfig.servers[name];
      if (!entry) {
        throw new Error(`server "${name}" not found`);
      }
      // 只动 connector 与 description；enabled/exposure/toolExposure 保留
      entry.connector = connector;
      const desc = typeof raw.description === "string" ? raw.description.trim().slice(0, 250) : "";
      if (desc) entry.description = desc;
      else delete entry.description;
      await saveGlobalConfig();
      await syncConnections(); // cfgKey 变化 → 自动断开重连
      const p = pool.get(name);
      recomputeAll();
      sendJson(res, 200, {
        ok: true,
        server: name,
        applied: "live",
        status: p ? p.conn.status : "connecting",
        tools: p && p.conn.status === "connected" ? p.conn.tools.length : 0,
        note:
          p && p.conn.status === "connected"
            ? `reconnected immediately, ${p.conn.tools.length} tools`
            : `connection failed or pending: ${p && p.conn.error ? p.conn.error : "connecting"}`,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleRemove(req, res) {
    try {
      const args = JSON.parse(await readBody(req));
      const server = typeof args?.server === "string" ? args.server.trim() : "";
      if (!SERVER_NAME_RE.test(server)) {
        sendJson(res, 400, { ok: false, error: "server name invalid" });
        return;
      }
      // 断开 + 删配置，即时生效
      const p = pool.get(server);
      if (p) {
        p.conn.close();
        pool.delete(server);
      }
      const hadEntry = delete globalConfig.servers[server];
      await saveGlobalConfig();
      syncGlobalTools(); // 注销该服务器的全局工具
      recomputeAll();
      sendJson(res, 200, {
        ok: true,
        server,
        applied: "live",
        note: p || hadEntry ? "disconnected and removed immediately" : "not configured",
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  let routesRegistered = false;
  const registerRoutes = () => {
    const web = ctx.get("webServer");
    if (web === undefined) return false;
    if (routesRegistered) return true;
    routesRegistered = true;
    const disposers = [
      web.register({ kind: "exact", path: "/plugins/mcp-gate/state", handler: handleState }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/master", handler: handleMaster }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/global", handler: handleGlobal }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/project", handler: handleProject }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/add", handler: handleAdd }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/import", handler: handleImport }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/update", handler: handleUpdate }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/remove", handler: handleRemove }),
    ];
    ctx.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {}
        }
      },
      "mcp-gate: routes",
    );
    return true;
  };

  // webServer 可能晚于本插件 apply 绑定（Service.init 异步）：失败时挂 internal/service 补注册。
  if (!registerRoutes()) {
    ctx.on("internal/service", (svcName) => {
      if (svcName === "webServer") registerRoutes();
    });
  }

  // 插件卸载/重载：关闭全部连接器连接（子进程/HTTP 会话）。
  ctx.effect(
    () => () => {
      for (const [, p] of pool) {
        try {
          p.conn.close();
        } catch {}
      }
      pool.clear();
    },
    "mcp-gate: connector pool",
  );

  // 启动即连（loadGlobalConfig 完成后）：把 config.json 里的 connector 服务器拉起来。
  loadGlobalConfig()
    .then((config) => {
      globalConfig = config;
      return syncConnections();
    })
    .catch(() => {});
}
