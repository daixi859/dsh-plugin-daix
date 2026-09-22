// dsh-fee-panel — host 面
//
// 官方插件规范：命名导出 name/inject/Config/apply，无 default export。
// - 数据来源（与 dsh-cost-meter 已验证端点一致，全部只读 GET）：
//     z.ai      GET api.z.ai|open.bigmodel.cn /api/monitor/usage/quota/limit（双域回退，
//               无效 Key 为 HTTP 200 + body code:401）
//     kimi      订阅 sk-kimi-* → GET api.kimi.com/coding/v1/usages（UA KimiCLI/1.6）；
//               开放平台 Key → GET api.moonshot.cn/v1/users/me/balance（分→元）
//     deepseek  GET api.deepseek.com/user/balance（多币种优先 CNY）
//     mimo      Cookie → GET platform.xiaomimimo.com/api/v1/balance + /api/v1/tokenPlan/usage
// - 凭据解析：本机凭据服务（ctx.credentials，含进程环境与 .env 分层），自定义 Key 写入
//   FEEPANEL_* 引用（凭据库持久化；不可写时回落内存）。
// - HTTP：经 ctx.subprocess 直接 spawn curl.exe（argv 直传；凭据只走 stdin 的
//   curl -H '@-'，不进命令行、不进环境变量）。z.ai 等 body 级 401 已处理。
// - 显示勾选持久化：~/.dsh/storages/fee-panel/config.json（node:fs 直读直写）。
// - 数据通道：webServer HTTP 路由（官方 extension-cookbook 推荐的面板数据通道）：
//     GET  /plugins/fee-panel/state       → { ok, providers: [...] }
//     POST /plugins/fee-panel/refresh     → { id? }          → { ok, providers }
//     POST /plugins/fee-panel/set-key     → { id, value }    → { ok, providers }
//     POST /plugins/fee-panel/set-enabled → { id, enabled }  → { ok, providers }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export const name = "fee-panel";
export const inject = ["timer"];

/** 无配置项；占位以符合官方 Config 形态。 */
export const Config = undefined;

const REFRESH_MS = 5 * 60 * 1000;

const PROVIDERS = [
  {
    id: "zai", label: "Z.ai / 智谱 GLM", short: "Z.ai", kindLabel: "订阅配额", inputType: "key",
    customRef: "FEEPANEL_ZAI_API_KEY", envRefs: ["ZAI_API_KEY", "BIGMODEL_API_KEY"],
    hint: "Coding Plan 专属 Key（z.ai / bigmodel.cn 控制台），两域 Key 不互通，失败时自动换域重试。",
  },
  {
    id: "kimi", label: "Kimi / Moonshot", short: "Kimi", kindLabel: "配额+余额", inputType: "key",
    customRef: "FEEPANEL_KIMI_API_KEY", envRefs: ["KIMI_CODING_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY"],
    hint: "订阅 Key（sk-kimi-*）显示周窗/5h 配额；开放平台 Key（sk-*）显示 PAYG 余额。",
  },
  {
    id: "deepseek", label: "DeepSeek", short: "DS", kindLabel: "余额", inputType: "key",
    customRef: "FEEPANEL_DEEPSEEK_API_KEY", envRefs: ["DEEPSEEK_API_KEY"],
    hint: "开放平台 Key，仅请求官方 api.deepseek.com。",
  },
  {
    id: "mimo", label: "MiMo / 小米", short: "MiMo", kindLabel: "需Cookie", inputType: "cookie",
    customRef: "FEEPANEL_MIMO_COOKIE", envRefs: ["MIMO_COOKIE"],
    hint: "MiMo 无 API-Key 端点：登录 platform.xiaomimimo.com → 控制台 → F12 复制 Cookie（含 api-platform_serviceToken），有效期约 1 天。",
  },
];

// ── 显示勾选持久化 ────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), ".dsh");
}

function configPath() {
  return join(dshHome(), "storages", "fee-panel", "config.json");
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

function ratioPct(used, limit, remaining) {
  const t = Number(limit);
  const u = Number(used);
  const r = Number(remaining);
  if (Number.isFinite(t) && t > 0 && Number.isFinite(u)) return clampPct((u / t) * 100);
  if (Number.isFinite(t) && t > 0 && Number.isFinite(r)) return clampPct(((t - r) / t) * 100);
  return null;
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

// ── 各家 fetcher（纯解析，错误均为软错误）─────────────────────────────────────

function parseZaiWindows(data) {
  const limits = data && data.data && Array.isArray(data.data.limits) ? data.data.limits : null;
  if (limits === null) return null;
  const named = {};
  const rest = [];
  for (const item of limits) {
    if (item === null || typeof item !== "object") continue;
    if (item.type !== "TOKENS_LIMIT" && item.type !== "CREDIT_LIMIT") continue;
    const pct = item.percentage !== undefined ? clampPct(item.percentage) : null;
    if (pct === null) continue;
    const resetsAt = resetIso(item.nextResetTime);
    const unit = Number(item.unit);
    if (unit === 3 && named.fiveHour === undefined) named.fiveHour = { label: "5h", percent: pct, resetsAt };
    else if (unit === 6 && named.weekly === undefined) named.weekly = { label: "周", percent: pct, resetsAt };
    else if (!Number.isFinite(unit)) rest.push({ percent: pct, resetsAt, ms: Number(item.nextResetTime) });
  }
  rest.sort((a, b) => (a.ms > 0 ? a.ms : 0) - (b.ms > 0 ? b.ms : 0));
  for (const item of rest) {
    if (named.fiveHour === undefined) named.fiveHour = { label: "5h", percent: item.percent, resetsAt: item.resetsAt };
    else if (named.weekly === undefined) named.weekly = { label: "周", percent: item.percent, resetsAt: item.resetsAt };
  }
  const windows = [];
  if (named.fiveHour !== undefined) windows.push(named.fiveHour);
  if (named.weekly !== undefined) windows.push(named.weekly);
  return windows.length > 0 ? windows : null;
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
      const windows = parseZaiWindows(data);
      if (windows !== null) return { quota: windows[0], windows, balanceText: null, balanceDetail: null };
      lastError = new Error("响应中无可解析的配额窗口");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("查询失败");
}

async function fetchKimi(ctx, key) {
  if (key.indexOf("sk-kimi-") === 0) {
    const data = await httpGet(ctx, "https://api.kimi.com/coding/v1/usages",
      ["Authorization: Bearer " + key, "User-Agent: KimiCLI/1.6", "Accept: application/json"]);
    throwIfBodyAuthError(data, "Kimi ");
    const windows = [];
    const usage = data && data.usage;
    if (usage !== null && typeof usage === "object") {
      const pct = ratioPct(usage.used, usage.limit, usage.remaining);
      if (pct !== null) windows.push({ label: "周", percent: pct, resetsAt: resetIso(usage.resetTime) });
    }
    const limits = Array.isArray(data && data.limits) ? data.limits : [];
    for (const row of limits) {
      const detail = row && row.detail;
      if (detail === null || typeof detail !== "object") continue;
      const pct = ratioPct(detail.used, detail.limit, detail.remaining);
      if (pct === null) continue;
      const duration = Number(row.window && row.window.duration);
      const unitRaw = String((row.window && row.window.timeUnit) || "").toLowerCase();
      const unit = unitRaw.indexOf("hour") === 0 ? "h" : unitRaw.indexOf("day") === 0 ? "d" : unitRaw.indexOf("week") === 0 ? "w" : unitRaw.indexOf("minute") === 0 ? "m" : "";
      const label = Number.isFinite(duration) && duration > 0 && unit !== "" ? String(duration) + unit : "窗口";
      windows.push({ label, percent: pct, resetsAt: resetIso(detail.resetTime) });
    }
    if (windows.length === 0) throw new Error("响应中无可解析的配额窗口");
    const five = windows.find((w) => w.label === "5h");
    return { quota: five || windows[0], windows, balanceText: null, balanceDetail: null };
  }
  const data = await httpGet(ctx, "https://api.moonshot.cn/v1/users/me/balance",
    ["Authorization: Bearer " + key]);
  throwIfBodyAuthError(data, "Kimi ");
  const raw = data && (data.available_balance !== undefined ? data.available_balance : (data.data && data.data.available_balance));
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("响应中无余额字段");
  const cny = n >= 100 ? n / 100 : n;
  return { quota: null, windows: [], balanceText: "¥" + cny.toFixed(2), balanceDetail: null };
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
  return { quota: null, windows: [], balanceText: cur + total.toFixed(2), balanceDetail: null };
}

// MiMo 主展示为余额；套餐窗口仅保留在 Tooltip。
async function fetchMimo(ctx, cookie) {
  const base = ["Cookie: " + cookie, "Accept: application/json", "User-Agent: Mozilla/5.0"];
  const windows = [];
  let balanceText = null;
  let okCount = 0;
  let lastError = null;
  try {
    const data = await httpGet(ctx, "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage", base);
    throwIfBodyAuthError(data, "MiMo ");
    const usage = data && data.data && data.data.usage;
    const items = usage && Array.isArray(usage.items) ? usage.items : [];
    for (const item of items) {
      if (item === null || typeof item !== "object") continue;
      const name = item.name === "plan_total_token" ? "套餐积分" : item.name === "compensation_total_token" ? "补偿积分" : String(item.name || "");
      const pct = ratioPct(item.used, item.limit);
      if (pct === null) continue;
      const yi = (v) => (Number(v) / 1e8).toFixed(1);
      const used = Number(item.used);
      const limit = Number(item.limit);
      windows.push({ label: name, percent: pct, resetsAt: "", detail: "余 " + yi(limit - used) + " / " + yi(limit) + " 亿" });
    }
    if (windows.length > 0) {
      okCount++;
    } else {
      const frac = Number(usage && usage.percent);
      if (Number.isFinite(frac)) {
        windows.push({ label: "套餐", percent: clampPct(frac * 100), resetsAt: "" });
        okCount++;
      }
    }
  } catch (err) {
    lastError = err;
  }
  try {
    const data = await httpGet(ctx, "https://platform.xiaomimimo.com/api/v1/balance", base);
    throwIfBodyAuthError(data, "MiMo ");
    const d = data && data.data;
    const total = Number(d && d.balance);
    if (!Number.isFinite(total)) throw new Error("响应中无余额字段");
    balanceText = "¥" + total.toFixed(2);
    okCount++;
  } catch (err) {
    lastError = err;
  }
  if (okCount === 0) throw lastError || new Error("查询失败");
  if (balanceText === null && windows.length > 0) {
    return { quota: windows[0], windows, balanceText: null, balanceDetail: null };
  }
  return { quota: null, windows, balanceText, balanceDetail: null };
}

const FETCHERS = { zai: fetchZai, kimi: fetchKimi, deepseek: fetchDeepSeek, mimo: fetchMimo };

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

// ── 插件主体 ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const memoryKeys = {};
  const enabled = { zai: true, kimi: true, deepseek: true, mimo: true };
  const entries = {};
  for (const def of PROVIDERS) {
    entries[def.id] = {
      status: "loading", quota: null, windows: [], balanceText: null, balanceDetail: null,
      credential: { source: "none", ref: def.envRefs[0] }, error: null, updatedAt: "",
    };
  }

  function snapshot() {
    return {
      providers: PROVIDERS.map((def) => {
        const e = entries[def.id];
        return {
          id: def.id, label: def.label, short: def.short, kindLabel: def.kindLabel,
          inputType: def.inputType, hint: def.hint, envRef: def.envRefs[0],
          enabled: enabled[def.id] === true,
          status: e.status, quota: e.quota, windows: e.windows,
          balanceText: e.balanceText, balanceDetail: e.balanceDetail,
          credential: e.credential, error: e.error, updatedAt: e.updatedAt,
        };
      }),
    };
  }

  async function loadEnabled() {
    try {
      const raw = await readFile(configPath(), "utf8");
      const cfg = JSON.parse(raw);
      if (cfg !== null && typeof cfg === "object" && cfg.enabled !== null && typeof cfg.enabled === "object") {
        for (const def of PROVIDERS) {
          if (typeof cfg.enabled[def.id] === "boolean") enabled[def.id] = cfg.enabled[def.id];
        }
      }
    } catch {}
  }

  async function persistEnabled() {
    try {
      await mkdir(join(dshHome(), "storages", "fee-panel"), { recursive: true });
      await writeFile(configPath(), JSON.stringify({ enabled }, null, 2), "utf8");
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
    if (enabled[def.id] !== true) return;
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
      entry.balanceDetail = result.balanceDetail;
      entry.status = "ok";
      entry.error = null;
    } catch (err) {
      entry.status = "error";
      entry.error = String(err && err.message ? err.message : err).slice(0, 120);
    }
    entry.updatedAt = new Date().toISOString();
  }

  function refreshAll() {
    return Promise.all(PROVIDERS.filter((def) => enabled[def.id] === true)
      .map((def) => refreshProvider(def).catch(() => {})));
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
        path: "/plugins/fee-panel/state",
        handler: handleState,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/fee-panel/refresh",
        handler: handleRefresh,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/fee-panel/set-key",
        handler: handleSetKey,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/fee-panel/set-enabled",
        handler: handleSetEnabled,
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
      "fee-panel: routes",
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
    sendJson(res, 200, { ok: true, providers: snapshot().providers });
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
      sendJson(res, 200, { ok: true, providers: snapshot().providers });
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
      enabled[def.id] = true;
      await persistEnabled();
      await refreshProvider(def);
      sendJson(res, 200, { ok: true, providers: snapshot().providers });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  async function handleSetEnabled(req, res) {
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
      const next = typeof (args && args.enabled) === "boolean" ? args.enabled : true;
      enabled[def.id] = next;
      await persistEnabled();
      if (next) await refreshProvider(def);
      sendJson(res, 200, { ok: true, providers: snapshot().providers });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
  }

  // ── 启动：读勾选配置 → 首轮刷新 → 定时刷新 ──────────────────────────────────
  void loadEnabled()
    .then(() => refreshAll())
    .catch(() => {});
  ctx.interval(() => {
    void refreshAll();
  }, REFRESH_MS);
}
