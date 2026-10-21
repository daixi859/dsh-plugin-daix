// dsh-mcp-gate — host 面
//
// 目标：MCP 工具渐进式披露（按 pi coding-agent 的 exposure 模型）+ 运行时接入管理。
//
// 接入两层来源（v0.3 起）：
//   1. 官方 @deepseek-ai/dsh-mcp-client（patch 里的 per-server 插件实例，遗留；可迁移）
//   2. 内置连接器（lib/connector.js）：服务器清单在 config.json 的 servers[name].connector，
//      运行时直连（stdio 子进程 / streamable-http），工具动态注册/注销，免重启。
// 工具名统一 `mcp__<serverName>__<rawName>`。
//
// 可见性控制（对两种来源一致）：
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
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
        // 同名工具已存在（如官方 mcp-client patch 接入同时注册）：标记已处理，不影响别的工具
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

  // ── 服务器接入管理（写 profile 主 patch 的 mcp-client insert 行）──────────
  //
  // 职责边界：mcp-client 实例的接入声明在 Cordis composition 里。本插件：
  //   add    → 文本级 append 一个 `- insert:` 块（新服务器，重启后由 Loader 接入）
  //   remove → 文本级移除该块（同上，重启生效）
  //   update → configEditor.edit(entry) 改已加载 entry 的 config（Loader reconcile，热生效）
  // patch 文件含用户注释，必须文本级操作而非整文件重序列化；写入前留 .bak。

  const MCP_CLIENT_NAME = "@deepseek-ai/dsh-mcp-client";
  const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

  function profilePatchPath() {
    try {
      const editor = ctx.get("configEditor");
      if (editor && typeof editor.documentPath === "string" && editor.documentPath.length > 0) {
        return editor.documentPath;
      }
    } catch {}
    const dir = process.env.DSH_PROFILE_DIR;
    if (dir && dir.trim().length > 0) return join(dir.trim(), "cordis.patch.yml");
    return join(dshHome(), "profiles", process.env.DSH_PROFILE || "desktop", "cordis.patch.yml");
  }

  /** YAML 标量：单引号字面（内部 ' 翻倍）。 */
  function yqScalar(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  /** flow 数组：args 用。元素按单引号标量序列化。 */
  function yqFlowArray(items) {
    return "[" + items.map((item) => yqScalar(item)).join(", ") + "]";
  }

  /** `${VAR}` 引用 → `!!js` 表达式（Loader 在加载时求值，值不落盘明文）。
   * 无引用的值返回 null（调用方按普通标量处理）。 */
  function envRefToJs(value) {
    const text = String(value);
    if (!/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(text)) return null;
    const expr = "`" + text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "${process.env.$1}")
      .replace(/\\/g, "\\\\") + "`";
    return "!!js " + yqScalar(expr);
  }

  function yqValue(value) {
    const asJs = envRefToJs(value);
    if (asJs !== null) return asJs;
    const text = String(value);
    if (/^[-?:,\[\]{}#&*!|>'"%@`]|:\s|\s$/.test(text) || text.trim() === "") return yqScalar(text);
    return text;
  }

  function yqMap(map, indent) {
    const pad = " ".repeat(indent);
    return Object.entries(map)
      .map(([key, value]) => {
        const asJs = envRefToJs(value);
        const rendered = asJs !== null ? asJs : yqScalar(value);
        return pad + yqScalar(key) + ": " + rendered;
      })
      .join("\n");
  }

  function buildInsertBlock(server) {
    const lines = [
      "# mcp-gate: " + server.name + " — added by mcp-gate UI",
      "- insert:",
      "    - id: mcp-" + server.name,
      "      name: " + yqScalar(MCP_CLIENT_NAME),
      "      config:",
      "        serverName: " + server.name,
    ];
    if (server.transport === "streamable-http") {
      lines.push("        transport: streamable-http");
      lines.push("        url: " + yqValue(server.url));
      const headers = server.headers || {};
      const keys = Object.keys(headers);
      if (keys.length > 0) {
        lines.push("        headers:");
        lines.push(yqMap(headers, 10));
      }
    } else {
      lines.push("        transport: stdio");
      lines.push("        command: " + yqValue(server.command));
      const args = Array.isArray(server.args) ? server.args.filter((a) => String(a).length > 0) : [];
      if (args.length > 0) lines.push("        args: " + yqFlowArray(args));
      const env = server.env || {};
      const envKeys = Object.keys(env);
      if (envKeys.length > 0) {
        lines.push("        env:");
        lines.push(yqMap(env, 10));
      }
      if (typeof server.cwd === "string" && server.cwd.length > 0) {
        lines.push("        cwd: " + yqValue(server.cwd));
      }
    }
    lines.push("        failOnStartupError: false");
    return lines.join("\n") + "\n";
  }

  function stripQuotes(text) {
    const t = text.trim();
    if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
      return t.slice(1, -1).replace(/''/g, "'");
    }
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    return t;
  }

  /** 引号感知的 flow 数组拆分：['a', 'b c'] → ["a", "b c"]。 */
  function parseFlowArray(text) {
    const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
    if (inner === "") return [];
    const out = [];
    let current = "";
    let quote = null;
    for (const ch of inner) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === ",") {
        out.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim().length > 0) out.push(current.trim());
    return out.map(stripQuotes);
  }

  function parseScalar(text) {
    const t = text.trim();
    if (t.startsWith("[")) return parseFlowArray(t);
    const asJs = t.startsWith("!!js");
    if (asJs) return t; // 表达式原样保留（含 !!js 前缀），编辑面板展示为 env 引用
    return stripQuotes(t);
  }

  /**
   * 受限解析：读 profile patch 里全部 dsh-mcp-client insert 行。
   * 返回 { [serverName]: { name, transport, command, args, env, url, headers, cwd } }。
   * 只处理已知键；块式与 flow 两种缩进形态都认。解析失败返回空表（不阻塞管理功能）。
   */
  function readPatchServers(patchText) {
    const servers = {};
    const lines = String(patchText).split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const topInsert = /^- insert:\s*$/.test(line);
      if (!topInsert) {
        i += 1;
        continue;
      }
      i += 1;
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^ {4}- id: (.+)$/);
        if (!itemMatch) {
          if (/^(- |[A-Za-z#])/.test(lines[i])) break; // 顶层 item / 注释 → insert 块结束
          i += 1;
          continue;
        }
        const rowId = stripQuotes(itemMatch[1]);
        // 向前看：本行是否 dsh-mcp-client 实例（6 空格 name 字段）
        let j = i + 1;
        let isMcpClient = false;
        let configIdx = -1;
        while (
          j < lines.length &&
          !/^ {4}- id: /.test(lines[j]) &&
          !/^- /.test(lines[j]) &&
          !/^[A-Za-z#]/.test(lines[j])
        ) {
          const nameMatch = lines[j].match(/^ {6}name: (.+)$/);
          if (nameMatch && stripQuotes(nameMatch[1]) === MCP_CLIENT_NAME) isMcpClient = true;
          if (/^ {6}config:\s*$/.test(lines[j])) configIdx = j;
          j += 1;
        }
        const blockEnd = j;
        if (isMcpClient && configIdx > 0) {
          const server = { name: rowId.startsWith("mcp-") ? rowId.slice(4) : rowId };
          let k = configIdx + 1;
          let nestedKey = null; // "args" | "env" | "headers" | null
          while (k < lines.length && k < blockEnd && /^ {8}/.test(lines[k])) {
            const field = lines[k].match(/^ {8}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
            const nestedItem = lines[k].match(/^ {10}(?:- )?(.+)$/);
            if (field) {
              const [, key, rest] = field;
              nestedKey = rest.trim() === "" ? key : null;
              if (rest.trim() !== "") {
                if (key === "args") server.args = parseScalar(rest);
                else if (key === "env" || key === "headers") { /* 不应出现，防御 */ }
                else server[key] = parseScalar(rest);
              } else if (key === "args" || key === "env" || key === "headers") {
                server[key] = server[key] || (key === "args" ? [] : {});
              } else {
                nestedKey = null;
              }
            } else if (nestedKey && nestedItem) {
              const valueText = nestedItem[1];
              if (nestedKey === "args") {
                server.args = server.args || [];
                server.args.push(parseScalar(valueText.replace(/^- /, "")));
              } else {
                server[nestedKey] = server[nestedKey] || {};
                const kv = valueText.match(/^([^:]+):\s*(.*)$/);
                if (kv) server[nestedKey][stripQuotes(kv[1])] = parseScalar(kv[2]);
              }
            }
            k += 1;
          }
          if (server.name && SERVER_NAME_RE.test(server.name)) servers[server.name] = server;
        }
        i = blockEnd;
      }
    }
    return servers;
  }

  function readPatchText() {
    const path = profilePatchPath();
    try {
      return { path, text: readFileSync(path, "utf8") };
    } catch (error) {
      if (error && error.code === "ENOENT") return { path, text: "[]\n" };
      throw error;
    }
  }

  /** 写 patch 的安全网：.bak 备份 → 写入。不引入 yaml 解析依赖：append/remove 都是行级操作、
   * 内容由本插件序列化；若用户手改出坏 YAML，Loader 重启时会报错，可用 .bak 恢复。 */
  /** 纯文本变换：删除空壳 insert 项（"- insert:" 行而其下没有任何 4 空格 item），
   * 连同紧邻的 "# mcp-gate:" 注释头。来源：旧版 removeBlockFromText 不吞块头在 patch
   * 里留下的 "- insert:" 空项（Loader 视作 insert: null）。所有 patch 写盘前兜底清理。 */
  function cleanEmptyInsertShells(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; ) {
      if (lines[i] === "- insert:") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j += 1;
        const hasItem = j < lines.length && /^ {4}\S/.test(lines[j]);
        if (!hasItem) {
          // 空壳：连同上方连续的 mcp-gate 注释行一起删
          let start = out.length;
          while (start > 0 && out[start - 1].startsWith("# mcp-gate:")) start -= 1;
          out.length = start;
          i = j;
          continue;
        }
      }
      out.push(lines[i]);
      i += 1;
    }
    return out.join("\n");
  }

  function writePatchChecked(path, nextText) {
    nextText = cleanEmptyInsertShells(nextText);
    let before = -1;
    try {
      before = statSync(path).size;
      copyFileSync(path, path + ".mcp-gate.bak");
    } catch {} // 首次写入（文件还不存在）没有备份
    writeFileSync(path, nextText, "utf8");
    debugLog(`patch write ${path}: ${before}B -> ${Buffer.byteLength(nextText, "utf8")}B`);
  }

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

  /** 显示转换：`!!js \`...${process.env.VAR}...\`` → `...${VAR}...`（编辑面板预填用）。
   * 兼容 yqScalar 包裹形态 `!!js '\`...\`'`。 */
  function jsToEnvRef(value) {
    const match = String(value).match(/^!!js\s+'?`([\s\S]*)`'?$/);
    if (!match) return value;
    return match[1]
      .replace(/\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}/g, "${$1}")
      .replace(/\\\\/g, "\\");
  }

  /** 编辑面板预填视图：patch 解析结果 → ${ENV} 引用形态的普通对象。 */
  function connectorView(server) {
    if (!server) return null;
    const view = { name: server.name, transport: server.transport === "streamable-http" ? "streamable-http" : "stdio" };
    const mapValue = (value) =>
      Array.isArray(value)
        ? value.map(jsToEnvRef)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsToEnvRef(v)]))
          : jsToEnvRef(value);
    for (const key of ["command", "cwd", "url"]) {
      if (server[key] != null) view[key] = jsToEnvRef(server[key]);
    }
    for (const key of ["args", "env", "headers"]) {
      if (server[key] != null) view[key] = mapValue(server[key]);
    }
    return view;
  }

  /** add：清理遗留顶层行后 append 独立 insert 块。返回 applied 状态。 */
  function addServerToPatch(server) {
    const { path, text } = readPatchText();
    // 先清掉遗留的顶层直接 entry（configEditor append / 手贴），再在干净文本上查重——
    // 否则遗留行会挡住重新添加，且与新增 insert 块构成 duplicate id。
    const { text: stripped, removed } = stripStrayServerRows(text, server.name);
    const existing = readPatchServers(stripped);
    // 查重不只看标准 insert 块：其他来源（bundle 层等）的 4 空格 - id: mcp-<name> 也算已存在
    const idLine = new RegExp("^\\s*-\\s+id:\\s*[\"']?mcp-" + server.name + "[\"']?\\s*$", "m");
    if (existing[server.name] || idLine.test(stripped)) {
      throw new Error(`server "${server.name}" already exists in profile patch`);
    }
    const trimmed = stripped.length > 0 && stripped.endsWith("\n") ? stripped : stripped + "\n";
    writePatchChecked(path, trimmed + (removed > 0 ? "" : "\n") + buildInsertBlock(server));
    return "restart-required";
  }

  /** 纯文本变换：定位并删除 mcp-<name> 的 insert item 块。返回 { text, found }。 */
  function removeBlockFromText(text, name) {
    const lines = text.split(/\r?\n/);
    const marker = "- id: mcp-" + name;
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i] === "    " + marker) {
        // 确认是 mcp-client 实例而非恰好同 id 的其他行
        let isClient = false;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
          const m = lines[j].match(/^ {6}name: (.+)$/);
          if (m) {
            isClient = stripQuotes(m[1]) === MCP_CLIENT_NAME;
            break;
          }
        }
        if (isClient) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) return { text, found: false };
    const idIdx = start;
    // 吞块头：上方紧邻的连续注释行 + "- insert:" 行（结构 id ← "- insert:" ← "# 注释" ← 空行，
    // 循环吞到不动为止，否则留下 "# mcp-gate:" 注释或 "- insert:" 空壳项）
    let head = start;
    for (;;) {
      if (head > 0 && (lines[head - 1].startsWith("#") || lines[head - 1] === "- insert:")) {
        head -= 1;
        continue;
      }
      break;
    }
    start = head;
    let end = lines.length;
    // 边界从原 id 行之后找（head 前移过，若从 head+1 找会把自家 id 行误当下一块）
    for (let i = idIdx + 1; i < lines.length; i += 1) {
      if (/^ {4}- id: /.test(lines[i]) || /^- /.test(lines[i])) {
        end = i;
        break;
      }
    }
    // 吞掉块后紧跟的空行
    while (end < lines.length && lines[end].trim() === "") end += 1;
    return { text: lines.slice(0, start).concat(lines.slice(end)).join("\n"), found: true };
  }

  /** remove：删掉 mcp-<name> 的 insert item（4 空格缩进块）。 */
  function removeServerFromPatch(name) {
    const { path, text } = readPatchText();
    const { text: stripped, removed: strayRemoved } = stripStrayServerRows(text, name);
    const { text: next, found } = removeBlockFromText(stripped, name);
    if (!found && !strayRemoved) return "not-in-patch"; // 不在 patch（如 bundle 层定义）：由 handleRemove 继续清理全局条目
    writePatchChecked(path, next);
    return "restart-required";
  }

  /** 纯文本变换：删除 patch 里 mcp-<name> 的"顶层直接 entry"行块（非 4 空格 insert item）。
   * 来源有二：configEditor.edit 对 insert 块 entry 写 config 时会 append 顶层行
   * （dsh-config-editor findLastIndex 找不到非-insert 同 id 行就 document.add），以及用户手贴。
   * 这类行与 insert 块构成 duplicate id，且其 config 是 loader 内存态的转写（含过期的
   * headers 键名），必须清除。返回 { text, removed }。 */
  function stripStrayServerRows(text, name) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let removed = 0;
    for (let i = 0; i < lines.length; ) {
      const m = lines[i].match(/^- id: mcp-([A-Za-z0-9_-]{1,32})\s*$/);
      // 仅匹配顶层（0 缩进）的 - id: mcp-<name>；insert item 是 4 空格缩进，不会命中
      if (m && (name === undefined || m[1] === name)) {
        // 确认 name 行是 mcp-client 实例而非恰好同 id 的其他配置
        let isClient = false;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
          const nm = lines[j].match(/^\s{2}name: (.+)$/);
          if (nm) {
            isClient = stripQuotes(nm[1]) === MCP_CLIENT_NAME;
            break;
          }
        }
        if (isClient) {
          let end = lines.length;
          for (let k = i + 1; k < lines.length; k += 1) {
            if (/^- /.test(lines[k]) || /^ {4}- id: /.test(lines[k])) { end = k; break; }
          }
          while (end < lines.length && lines[end].trim() === "") end += 1;
          i = end;
          removed += 1;
          continue;
        }
      }
      out.push(lines[i]);
      i += 1;
    }
    return { text: out.join("\n"), removed };
  }

  /** update 的 patch 路径：清理遗留顶层行 + 删旧 insert 块 + append 新块，一次写盘。
   * insert 块定义的服务器不走 configEditor.edit——它找不到非-insert 同 id 行时会
   * append 一个顶层 config 行（duplicate id + 过期 headers 键名），见 stripStrayServerRows。 */
  function updateServerInPatch(server) {
    const { path, text } = readPatchText();
    const { text: stripped, removed } = stripStrayServerRows(text, server.name);
    const { text: without, found } = removeBlockFromText(stripped, server.name);
    if (!found && !removed) {
      throw new Error(`server "${server.name}" not found in profile patch`);
    }
    const base = without.length > 0 && without.endsWith("\n") ? without : without + "\n";
    writePatchChecked(path, base + "\n" + buildInsertBlock(server));
    return "restart-required";
  }

  // ── HTTP 路由（webServer 晚绑定）──



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

  /** server 视图聚合：实际注册 ∪ 全局配置 ∪ 项目覆盖 ∪ patch 接入声明。 */
  function buildServerViews(rootSchemas, projectServers, patchServers) {
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
    if (patchServers) for (const name of Object.keys(patchServers)) names.add(name);

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
      const legacy = Boolean(patchServers && patchServers[server]); // patch 里还有块（官方 mcp-client）
      const connector = g.connector || (legacy ? patchServers[server] : undefined);
      servers.push({
        name: server,
        toolCount: tools.length,
        description: typeof g.description === "string" ? g.description : "",
        globalEnabled: typeof g.enabled === "boolean" ? g.enabled : true,
        exposure,
        toolExposure: g.toolExposure || {},
        projectEnabled,
        enabled,
        connector: connectorView(connector),
        editable: true, // 无 connector 的条目也要可编辑（补配置即成为托管服务器）
        managed: Boolean(g.connector), // 内置连接器托管（可热操作）
        legacy, // patch 块定义（需迁移/重启）
        connectorMissing: !connector,
        connStatus: conn ? conn.status : legacy ? "external" : "disconnected",
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
      let patchServers = {};
      try {
        patchServers = readPatchServers(readPatchText().text);
      } catch (error) {
        debugLog(`readPatchServers failed: ${error && error.message}`);
      }
      sendJson(res, 200, {
        ok: true,
        master: globalConfig.mcpEnabled !== false,
        workspacePath: cwd,
        servers: buildServerViews(rootSchemas, projectServers, patchServers),
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

  async function handleAdd(req, res) {
    try {
      const raw = JSON.parse(await readBody(req));
      const server = normalizeServerInput(raw);
      const names = new Set(Object.keys(globalConfig.servers));
      try {
        const tools = ctx.get("tools");
        for (const t of (tools && tools.schemas ? tools.schemas() : [])) {
          if (typeof t.name === "string" && t.name.startsWith(MCP_PREFIX)) {
            names.add(splitToolName(t.name).server);
          }
        }
      } catch {}
      try {
        const patch = readPatchServers(readPatchText().text);
        for (const name of Object.keys(patch)) names.add(name);
      } catch {}
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
      let entry = globalConfig.servers[name];
      const inPatch = readPatchServers(readPatchText().text)[name];
      if (!entry && !inPatch) {
        throw new Error(`server "${name}" not found`);
      }
      if (inPatch) {
        // 遗留 patch 服务器（官方 mcp-client 块）：编辑即迁移到内置连接器
        removeServerFromPatch(name);
      }
      if (!entry) entry = globalConfig.servers[name] = { enabled: true };
      // 只动 connector 与 description；enabled/exposure/toolExposure 保留（entry 无 connector 时是补全配置）
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
      // 连接器托管的服务器：断开 + 删配置，即时生效
      const p = pool.get(server);
      if (p) {
        p.conn.close();
        pool.delete(server);
      }
      const hadEntry = delete globalConfig.servers[server];
      let patchNote = "";
      if (!p && !hadEntry) {
        // 遗留 patch 块（bundle/官方 mcp-client）：删 patch 块，仍需重启卸载
        const applied = removeServerFromPatch(server);
        patchNote = applied === "restart-required" ? "; removed from profile patch, restart DSH to fully unload" : "";
      }
      await saveGlobalConfig();
      syncGlobalTools(); // 注销该服务器的全局工具
      recomputeAll();
      sendJson(res, 200, {
        ok: true,
        server,
        applied: p || hadEntry ? "live" : "restart-required",
        note: (p || hadEntry ? "disconnected and removed immediately" : "legacy patch server") + patchNote,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  /** 遗留 patch 块 → config.json connector，一键迁移（可选指定 server；默认全部）。 */
  async function handleMigrate(req, res) {
    try {
      const args = await readBody(req);
      const only = args ? (JSON.parse(args)?.server ?? null) : null;
      const patchServers = readPatchServers(readPatchText().text);
      const names = only ? [only] : Object.keys(patchServers);
      const migrated = [];
      const skipped = [];
      for (const name of names) {
        const raw = patchServers[name];
        if (!raw) {
          skipped.push({ name, reason: "not in profile patch" });
          continue;
        }
        let connector;
        try {
          const { name: _n, ...cfg } = normalizeServerInput(raw);
          connector = sanitizeConnector(cfg);
        } catch (error) {
          skipped.push({ name, reason: String(error && error.message) });
          continue;
        }
        if (!connector) {
          skipped.push({ name, reason: "connector config invalid" });
          continue;
        }
        const existing = globalConfig.servers[name];
        globalConfig.servers[name] = { ...(existing || { enabled: true }), connector };
        const applied = removeServerFromPatch(name);
        migrated.push({ name, patchRemoved: applied === "restart-required" });
      }
      await saveGlobalConfig();
      await syncConnections();
      recomputeAll();
      sendJson(res, 200, {
        ok: true,
        migrated,
        skipped,
        note: migrated.length > 0 ? "migrated to built-in connector, live now" : "nothing to migrate",
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
      web.register({ kind: "exact", path: "/plugins/mcp-gate/update", handler: handleUpdate }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/remove", handler: handleRemove }),
      web.register({ kind: "exact", path: "/plugins/mcp-gate/migrate", handler: handleMigrate }),
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
