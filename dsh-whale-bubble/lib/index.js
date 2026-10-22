// dsh-whale-bubble — host 面
//
// 从 dsh-fee-panel 复制裁剪：只保留 z.ai（订阅配额）+ DeepSeek（余额）两家，
// 独立路由/存储，与 fee-panel 互不依赖。全部只读 GET：
//     z.ai      GET api.z.ai|open.bigmodel.cn /api/monitor/usage/quota/limit（双域回退，
//               无效 Key 为 HTTP 200 + body code:401）
//     deepseek  GET api.deepseek.com/user/balance（多币种优先 CNY）
// - 凭据解析：本机凭据服务（ctx.credentials，含进程环境与 .env 分层），自定义 Key 写入
//   WHALE_* 引用（凭据库持久化；不可写时回落内存）。
// - HTTP：经 ctx.subprocess 直接 spawn curl.exe（argv 直传；凭据只走 stdin 的
//   curl -H '@-'，不进命令行、不进环境变量）。
// - 显示开关持久化：~/.dsh/storages/whale-bubble/config.json（node:fs 直读直写）。
// - 数据通道：webServer HTTP 路由：
//     GET  /plugins/whale-bubble/state       → { ok, providers, workspace }
//     POST /plugins/whale-bubble/refresh     → { id? }        → { ok, providers, workspace }
//     POST /plugins/whale-bubble/set-key     → { id, value }  → { ok, providers, workspace }
//     POST /plugins/whale-bubble/set-visible → { visible }    → { ok, providers, workspace }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";

export const name = "whale-bubble";
export const inject = ["timer"];

/** 无配置项；占位以符合官方 Config 形态。 */
export const Config = undefined;

const REFRESH_MS = 5 * 60 * 1000;

const PROVIDERS = [
  {
    id: "zai", label: "Z.ai / 智谱 GLM", short: "Z.ai", kindLabel: "订阅配额",
    customRef: "WHALE_ZAI_API_KEY", envRefs: ["ZAI_API_KEY", "BIGMODEL_API_KEY"],
    hint: "Coding Plan 专属 Key（z.ai / bigmodel.cn 控制台），两域 Key 不互通，失败时自动换域重试。",
  },
  {
    id: "deepseek", label: "DeepSeek", short: "DS", kindLabel: "余额",
    customRef: "WHALE_DEEPSEEK_API_KEY", envRefs: ["DEEPSEEK_API_KEY"],
    hint: "开放平台 Key，仅请求官方 api.deepseek.com。",
  },
];

// ── 显示开关持久化 ────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), ".dsh");
}

function configPath() {
  return join(dshHome(), "storages", "whale-bubble", "config.json");
}

// ── 数值/时间工具 ─────────────────────────────────────────────────────────────

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function resetIso(v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "string") {
    const p = Date.parse(v);
    if (Number.isFinite(p)) return new Date(p).toISOString();
    v = Number(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// ── HTTP：subprocess + curl.exe（凭据只走 stdin）─────────────────────────────

async function httpGet(ctx, url, headerLines) {
  const subprocess = ctx.get("subprocess");
  if (subprocess === undefined) {
    const e = new Error("subprocess 服务不可用");
    e.soft = true;
    throw e;
  }
  let curlPath = "curl.exe";
  try {
    curlPath = await subprocess.resolveExecutable("curl.exe");
  } catch {}
  const stdin = headerLines.join("\n") + "\n";
  let handle = null;
  const kill = ctx.timeout(() => {
    if (handle !== null) handle.terminate();
  }, 20000);
  try {
    handle = subprocess.spawn({
      argv: [curlPath, "-sS", "-m", "15", "-w", "\n%{http_code}", "-H", "@-", url],
      cwd: "C:/",
      graceMs: 3000,
      stdio: {
        stdin: { data: stdin },
        stdout: { maxBytes: 262144 },
        stderr: { maxBytes: 65536 },
      },
    });
    const outcome = await handle.done;
    const out = handle.collected.stdout !== undefined ? handle.collected.stdout.readFrom(0) : { text: "" };
    const errOut = handle.collected.stderr !== undefined ? handle.collected.stderr.readFrom(0) : { text: "" };
    if (outcome.exitCode !== 0) {
      const last = String(errOut.text || "").trim().split("\n").pop() || ("exit " + String(outcome.exitCode));
      throw new Error("网络请求失败：" + last.slice(0, 80));
    }
    const trimmed = out.text.replace(/\s+$/, "");
    const idx = trimmed.lastIndexOf("\n");
    const statusText = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
    const body = idx >= 0 ? trimmed.slice(0, idx) : "";
    const status = parseInt(statusText, 10);
    if (!Number.isFinite(status)) throw new Error("响应解析失败");
    if (status === 401 || status === 403) {
      const e = new Error("凭据无效或已过期（HTTP " + status + "）");
      e.auth = true;
      throw e;
    }
    if (status < 200 || status >= 300) throw new Error("HTTP " + status);
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error("响应不是有效 JSON");
    }
    return data;
  } finally {
    kill();
  }
}

function throwIfBodyAuthError(data, who) {
  if (data !== null && typeof data === "object" && (data.code === 401 || data.code === "401")) {
    const e = new Error(who + "凭据无效（" + String(data.msg || "token incorrect").slice(0, 40) + "）");
    e.auth = true;
    throw e;
  }
}

// ── fetcher：z.ai（只取 5h 窗口）+ DeepSeek（余额，CNY 优先）────────────────

/**
 * z.ai 监控端点 limits 解析（2026-09 实测响应）：
 * TOKENS_LIMIT unit 3=小时档(number=5→5h)。气泡只展示 5h 窗口，
 * 其余条目（周档/CREDIT_LIMIT/TIME_LIMIT）忽略。
 */
function parseZaiFiveHour(data) {
  const limits = data && data.data && Array.isArray(data.data.limits) ? data.data.limits : null;
  if (limits === null) return null;
  const fiveHour = [];
  const rest = [];
  for (const item of limits) {
    if (item === null || typeof item !== "object") continue;
    if (item.type !== "TOKENS_LIMIT" && item.type !== "CREDIT_LIMIT") continue;
    const pct = item.percentage !== undefined ? clampPct(item.percentage) : null;
    if (pct === null) continue;
    const unit = Number(item.unit);
    if (unit === 3) fiveHour.push({ label: "5h", percent: pct, resetsAt: resetIso(item.nextResetTime) });
    else if (!Number.isFinite(unit)) rest.push({ percent: pct, resetsAt: resetIso(item.nextResetTime), ms: Number(item.nextResetTime) });
  }
  if (fiveHour.length > 0) return fiveHour[0];
  rest.sort((a, b) => (a.ms > 0 ? a.ms : 0) - (b.ms > 0 ? b.ms : 0));
  if (rest.length > 0) return { label: "5h", percent: rest[0].percent, resetsAt: rest[0].resetsAt };
  return null;
}

async function fetchZai(ctx, key) {
  const urls = [
    "https://api.z.ai/api/monitor/usage/quota/limit",
    "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const data = await httpGet(ctx, url, ["Authorization: Bearer " + key]);
      throwIfBodyAuthError(data, "z.ai ");
      const quota = parseZaiFiveHour(data);
      if (quota !== null) return { quota, windows: [quota], balanceText: null };
      lastError = new Error("响应中无可解析的配额窗口");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("查询失败");
}

async function fetchDeepSeek(ctx, key) {
  const data = await httpGet(ctx, "https://api.deepseek.com/user/balance",
    ["Authorization: Bearer " + key]);
  throwIfBodyAuthError(data, "DeepSeek ");
  const infos = data && Array.isArray(data.balance_infos) ? data.balance_infos : [];
  if (infos.length === 0) throw new Error("响应中无 balance_infos");
  const info = infos.find((i) => i && i.currency === "CNY") || infos[0];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cur = info && info.currency === "USD" ? "$" : "¥";
  const total = num(info && info.total_balance);
  return { quota: null, windows: [], balanceText: cur + total.toFixed(2) };
}

const FETCHERS = { zai: fetchZai, deepseek: fetchDeepSeek };

// ── HTTP 工具（webServer 路由用）──────────────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, maxBytes = 1000000) {
  return new Promise((resolvePromise, reject) => {
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
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── 插件主体 ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const memoryKeys = {};
  let visible = true;
  const entries = {};
  for (const def of PROVIDERS) {
    entries[def.id] = {
      status: "loading", quota: null, windows: [], balanceText: null,
      credential: { source: "none", ref: def.envRefs[0] }, error: null, updatedAt: "",
    };
  }

  function workspaceInfo() {
    // 当前工作区 = 最近活跃（updatedAt 最新）的注册工作区；
    // 注册表不可用时回落到进程 cwd。
    try {
      const reg = ctx.get("workspaceRegistry");
      const list = reg && typeof reg.list === "function" ? reg.list() : null;
      if (Array.isArray(list) && list.length > 0) {
        let best = null;
        let bestTs = -1;
        for (const w of list) {
          if (!w || !w.path) continue;
          const ts = Date.parse(w.updatedAt || "") || 0;
          if (ts > bestTs) { bestTs = ts; best = w; }
        }
        if (best) {
          return {
            title: best.title || basename(best.path) || best.path,
            path: best.path,
          };
        }
      }
    } catch {}
    let cwd = process.cwd();
    try {
      const env = process.env.PWD;
      if (typeof env === "string" && env.trim().length > 0) cwd = resolve(env);
    } catch {}
    return { title: basename(cwd) || cwd, path: cwd };
  }

  function snapshot() {
    return {
      visible,
      workspace: workspaceInfo(),
      providers: PROVIDERS.map((def) => {
        const e = entries[def.id];
        return {
          id: def.id, label: def.label, short: def.short, kindLabel: def.kindLabel,
          hint: def.hint, envRef: def.envRefs[0],
          status: e.status, quota: e.quota, windows: e.windows,
          balanceText: e.balanceText,
          credential: e.credential, error: e.error, updatedAt: e.updatedAt,
        };
      }),
    };
  }

  async function loadConfig() {
    try {
      const raw = await readFile(configPath(), "utf8");
      const cfg = JSON.parse(raw);
      if (cfg !== null && typeof cfg === "object") {
        if (typeof cfg.visible === "boolean") visible = cfg.visible;
      }
    } catch {}
  }

  async function persistConfig() {
    try {
      await mkdir(join(dshHome(), "storages", "whale-bubble"), { recursive: true });
      await writeFile(configPath(), JSON.stringify({ visible }, null, 2), "utf8");
    } catch {}
  }

  async function resolveKey(def) {
    const credentials = ctx.get("credentials");
    if (memoryKeys[def.id] !== undefined) {
      return { value: memoryKeys[def.id], source: "custom", ref: def.customRef + "（内存）" };
    }
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(def.customRef);
        if (hit !== undefined && typeof hit.value === "string" && hit.value.length > 0) {
          return { value: hit.value, source: "custom", ref: def.customRef };
        }
      } catch {}
      for (const ref of def.envRefs) {
        try {
          const hit = await credentials.resolve(ref);
          if (hit !== undefined && typeof hit.value === "string" && hit.value.length > 0) {
            return { value: hit.value, source: "env", ref };
          }
        } catch {}
      }
    }
    return null;
  }

  async function refreshProvider(def) {
    const entry = entries[def.id];
    let cred = null;
    try {
      cred = await resolveKey(def);
    } catch {}
    if (cred === null) {
      entry.status = "no-key";
      entry.credential = { source: "none", ref: def.envRefs[0] };
      entry.error = null;
      entry.updatedAt = new Date().toISOString();
      return;
    }
    entry.credential = { source: cred.source, ref: cred.ref };
    try {
      const result = await FETCHERS[def.id](ctx, cred.value);
      entry.quota = result.quota;
      entry.windows = result.windows;
      entry.balanceText = result.balanceText;
      entry.status = "ok";
      entry.error = null;
    } catch (err) {
      entry.status = "error";
      entry.error = String(err && err.message ? err.message : err).slice(0, 120);
    }
    entry.updatedAt = new Date().toISOString();
  }

  function refreshAll() {
    return Promise.all(PROVIDERS.map((def) => refreshProvider(def).catch(() => {})));
  }

  function findDef(raw) {
    const id = String(raw == null ? "" : raw);
    return PROVIDERS.find((def) => def.id === id) || null;
  }

  // ── webServer 路由 ──────────────────────────────────────────────────────────
  let routesRegistered = false;

  const registerRoutes = () => {
    const web = ctx.get("webServer");
    if (web === undefined) return false;
    if (routesRegistered) return true;
    routesRegistered = true;
    const disposers = [
      web.register({
        kind: "exact",
        path: "/plugins/whale-bubble/state",
        handler: handleState,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/whale-bubble/refresh",
        handler: handleRefresh,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/whale-bubble/set-key",
        handler: handleSetKey,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/whale-bubble/set-visible",
        handler: handleSetVisible,
      }),
    ];
    ctx.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {}
        }
      },
      "whale-bubble: routes",
    );
    return true;
  };

  // webServer 可能晚于本插件 apply 绑定（Service.init 异步）：首次失败时挂 internal/service 补注册。
  if (!registerRoutes()) {
    ctx.on("internal/service", (svcName) => {
      if (svcName === "webServer") registerRoutes();
    });
  }

  async function handleState(req, res) {
    sendJson(res, 200, { ok: true, ...snapshot() });
  }

  async function handleRefresh(req, res) {
    try {
      const raw = await readBody(req);
      let args = {};
      if (raw && raw.trim().length > 0) {
        try {
          args = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid JSON body" });
          return;
        }
      }
      const def = findDef(args && args.id);
      if (def !== null) await refreshProvider(def);
      else await refreshAll();
      sendJson(res, 200, { ok: true, ...snapshot() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  async function handleSetKey(req, res) {
    try {
      const raw = await readBody(req);
      let args;
      try {
        args = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const def = findDef(args && args.id);
      if (def === null) {
        sendJson(res, 400, { ok: false, error: "未知供应商" });
        return;
      }
      let value = String(args && args.value == null ? "" : args.value).trim();
      if (value.length > 8192) value = value.slice(0, 8192);
      delete memoryKeys[def.id];
      const credentials = ctx.get("credentials");
      if (value === "") {
        if (credentials !== undefined) {
          try { await credentials.unset(def.customRef); } catch {}
        }
      } else {
        let stored = false;
        if (credentials !== undefined) {
          try {
            await credentials.set(def.customRef, value);
            stored = true;
          } catch {
            stored = false;
          }
        }
        if (!stored) memoryKeys[def.id] = value;
      }
      await refreshProvider(def);
      sendJson(res, 200, { ok: true, ...snapshot() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  async function handleSetVisible(req, res) {
    try {
      const raw = await readBody(req);
      let args;
      try {
        args = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      visible = typeof (args && args.visible) === "boolean" ? args.visible : true;
      await persistConfig();
      sendJson(res, 200, { ok: true, ...snapshot() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  // ── 启动：读配置 → 首轮刷新 → 定时刷新 ──────────────────────────────────────
  void loadConfig()
    .then(() => refreshAll())
    .catch(() => {});
  ctx.interval(() => {
    void refreshAll();
  }, REFRESH_MS);
}
