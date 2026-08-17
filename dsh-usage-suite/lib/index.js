// dsh-usage-suite — host half.
//
// Usage meter for three model providers, exposed to the browser half through
// same-origin JSON endpoints:
//
//   opencode-go  cookie-authenticated SSR scrape of the Go dashboard page
//                (the dsh-ocgo-usage approach, with zh+en label support)
//   deepseek     official balance API (api.deepseek.com/user/balance)
//   zhipu        GLM Coding Plan (CN) quota API
//                (open.bigmodel.cn/api/monitor/usage/quota/limit)
//
// Fetching is strictly request-driven: the host never polls upstream. The
// browser half asks for one provider at a time (the session's current
// provider) and refreshes when a conversation turn ends, so each upstream
// read happens only when the user is actually looking at real usage.
//
// Config resolution (highest first):
//   1. $DSH_HOME/usage-suite.json     { ocgo: {workspaceID, cookie},
//                                       deepseek: {apiKey}, zhipu: {apiKey} }
//   2. process env                    OPENCODE_GO_WORKSPACE_ID / OPENCODE_GO_COOKIE
//                                     DEEPSEEK_API_KEY / ZAI_CODING_CN_API_KEY
//   3. $DSH_HOME/.credentials.yaml    values keyed by the env names above
//   4. ocgo fallback: $DSH_HOME/ocgo-usage.json (dsh-ocgo-usage's file)
//
// Secrets never leave the host: /api/model-usage/config serves masked tails
// only, and error messages are redacted before they reach the wire.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Stable cordis plugin name (matches the cordis.patch.yml row id). */
export const name = "usage-suite";

/** Services required before the usage service can answer. */
export const inject = ["webServer"];

// ── defaults ─────────────────────────────────────────────────────────────────

/** How long a provider's successful read stays fresh (ms). */
const DEFAULT_CACHE_TTL_MS = 60_000;
/** How long a provider's failed read suppresses retries (ms). */
const DEFAULT_COOLDOWN_MS = 60_000;
/** Per-request upstream timeout (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

const OCGO_BASE_URL = "https://opencode.ai";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const ZHIPU_QUOTA_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

/** The providers this suite knows, in chip order. */
const PROVIDERS = ["ocgo", "deepseek", "zhipu"];

// ── config resolution ────────────────────────────────────────────────────────

const dshHome = () => {
	const env = process.env.DSH_HOME;
	return env !== undefined && env.trim().length > 0 ? env : join(homedir(), ".dsh");
};

/** Read a JSON file, returning undefined when missing/unparseable. */
function readJsonIfExists(path) {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Parse the tiny scalar subset of ~/.dsh/.credentials.yaml that dsh writes:
 * top-level `ENV_NAME: value` rows. Values may be quoted; comments ignored.
 * @returns {Map<string, string>}
 */
function readCredentialsFile() {
	const map = new Map();
	const path = join(dshHome(), ".credentials.yaml");
	if (!existsSync(path)) return map;
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const match = /^[A-Za-z0-9_]+\s*:\s*(.*)$/.exec(line);
		if (match === null) continue;
		let value = match[1].trim();
		if (value.length === 0 || value.startsWith("#")) continue;
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (value.length > 0) map.set(match[0].slice(0, match[0].indexOf(":")).trim(), value);
	}
	return map;
}

const firstString = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
};

/** Resolve one provider's effective credentials + display metadata. */
function resolveProviderConfig(provider) {
	const own = readJsonIfExists(join(dshHome(), "usage-suite.json")) ?? {};
	const creds = readCredentialsFile();
	if (provider === "ocgo") {
		const legacy = readJsonIfExists(join(dshHome(), "ocgo-usage.json")) ?? {};
		const workspaceID = firstString(
			own.ocgo?.workspaceID,
			process.env.OPENCODE_GO_WORKSPACE_ID,
			legacy.workspaceID
		);
		const cookie = normalizeCookie(firstString(
			own.ocgo?.cookie,
			process.env.OPENCODE_GO_COOKIE,
			legacy.cookie
		));
		return { provider, workspaceID, cookie, baseUrl: firstString(own.ocgo?.baseUrl) ?? OCGO_BASE_URL };
	}
	if (provider === "deepseek") {
		const apiKey = firstString(
			own.deepseek?.apiKey,
			process.env.DEEPSEEK_API_KEY,
			creds.get("DEEPSEEK_API_KEY")
		);
		return { provider, apiKey };
	}
	if (provider === "zhipu") {
		const apiKey = firstString(
			own.zhipu?.apiKey,
			process.env.ZAI_CODING_CN_API_KEY,
			creds.get("ZAI_CODING_CN_API_KEY")
		);
		return { provider, apiKey };
	}
	return { provider };
}

/**
 * Normalize a user-provided OpenCode cookie string into a `Cookie:` header
 * value (dsh-ocgo-usage semantics, but oc_locale always defaults to en: the
 * dashboard SSR labels this suite parses are matched for both locales, yet
 * the reset-time phrase parser is far more reliable in English).
 */
export function normalizeCookie(input) {
	if (typeof input !== "string") return undefined;
	const trimmed = input.trim().replace(/\s+/g, " ");
	if (trimmed.length === 0) return undefined;
	const segments = trimmed.split(/;\s*/).filter(Boolean);
	const authSeg = segments.find((segment) => segment.startsWith("auth="))
		?? (/^Fe26\./.test(segments[0] ?? "") ? "auth=" + segments[0] : undefined);
	if (authSeg === undefined) return undefined;
	return authSeg + "; oc_locale=en";
}

// ── provider fetchers ────────────────────────────────────────────────────────

/** Structured usage error; `code` drives the chip's <err:…> face. */
export class UsageError extends Error {
	constructor(message, code) {
		super(message);
		this.code = code;
	}
}

/** fetch() text with timeout; secrets are redacted from any thrown message. */
async function fetchText(url, headers, timeoutMs, secrets) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
		if (!res.ok) throw new UsageError("HTTP " + String(res.status) + " for " + url, "http" + String(res.status));
		return await res.text();
	} catch (error) {
		if (error instanceof UsageError) throw error;
		if (error instanceof Error && error.name === "AbortError") {
			throw new UsageError("request timed out after " + String(timeoutMs) + "ms", "timeout");
		}
		throw new UsageError(redact(String(error?.message ?? error), secrets), "fetch");
	} finally {
		clearTimeout(timer);
	}
}

/** fetch() JSON with timeout; secrets are redacted from any thrown message. */
async function fetchJson(url, headers, timeoutMs, secrets) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "error" });
		const text = await res.text();
		if (!res.ok) {
			const detail = text.length > 0 && text.length <= 300 ? ": " + redact(truncate(text, 200), secrets) : "";
			throw new UsageError("HTTP " + String(res.status) + detail, "http" + String(res.status));
		}
		try {
			return JSON.parse(text);
		} catch {
			throw new UsageError("provider returned invalid JSON", "parse");
		}
	} catch (error) {
		if (error instanceof UsageError) throw error;
		if (error instanceof Error && error.name === "AbortError") {
			throw new UsageError("request timed out after " + String(timeoutMs) + "ms", "timeout");
		}
		throw new UsageError(redact(String(error?.message ?? error), secrets), "fetch");
	} finally {
		clearTimeout(timer);
	}
}

const redact = (text, secrets) => {
	let out = text;
	for (const secret of secrets) {
		if (typeof secret === "string" && secret.length >= 8) out = out.split(secret).join("[redacted]");
	}
	return out;
};

const truncate = (text, max) => {
	const trimmed = text.trim();
	return trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed;
};

// ── opencode-go: SSR scrape ──────────────────────────────────────────────────

/** Map a usage-label (en or zh) to a window key. */
function labelToKey(label) {
	const lower = label.toLowerCase();
	if (lower.startsWith("rolling") || label.startsWith("滚动")) return "rolling";
	if (lower.startsWith("weekly") || label.startsWith("每周")) return "weekly";
	if (lower.startsWith("monthly") || label.startsWith("每月")) return "monthly";
	return undefined;
}

const DURATION_UNITS = [
	[/^(seconds?|secs?|s|秒)$/i, 1],
	[/^(minutes?|mins?|m|分钟)$/i, 60],
	[/^(hours?|hrs?|h|小时)$/i, 3600],
	[/^(days?|d|天)$/i, 86400]
];

/** Parse "28 minutes" / "15 小时 40 分钟" / "27 天 17 小时" into seconds. */
export function parseDurationToSec(text) {
	let total = 0;
	const re = /(\d+)\s*([A-Za-z\u4e00-\u9fff]+)/g;
	let match = re.exec(text);
	while (match !== null) {
		const amount = Number.parseInt(match[1], 10);
		const unit = match[2];
		for (const [unitRe, seconds] of DURATION_UNITS) {
			if (unitRe.test(unit)) {
				total += amount * seconds;
				break;
			}
		}
		match = re.exec(text);
	}
	return total > 0 ? total : undefined;
}

const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "").trim();

/**
 * Parse the Go dashboard SSR HTML: each window is one
 * `<div data-slot="usage-item">` block with a label, percent, and reset
 * phrase. Works for both the English and the Chinese dashboard locale.
 */
export function parseOcgoSSR(html) {
	const starts = [];
	const re = /<div[^>]*data-slot="usage-item"/g;
	let match = re.exec(html);
	while (match !== null) {
		starts.push(match.index);
		match = re.exec(html);
	}
	const windows = [];
	for (let i = 0; i < starts.length; i++) {
		const block = html.slice(starts[i], starts[i + 1] ?? html.length);
		const labelMatch = block.match(/data-slot="usage-label"[^>]*>([^<]+)</);
		const valueMatch = block.match(/data-slot="usage-value"[\s\S]*?<!--\$-->\s*(\d+)\s*<!--\/-->/);
		const resetMatch = block.match(/data-slot="reset-time"[\s\S]*?(?:Resets in|重置于)(?:<!--\/-->\s*)?([\s\S]*?)(?:<!--\/-->|<\/span>)/);
		if (labelMatch === null || valueMatch === null) continue;
		const key = labelToKey(labelMatch[1]?.trim() ?? "");
		if (key === undefined) continue;
		const percent = Number.parseInt(valueMatch[1] ?? "0", 10);
		const resetText = resetMatch !== null ? stripHtmlComments(resetMatch[1] ?? "") : "";
		windows.push({
			key,
			label: key,
			kind: "percent",
			percent: Math.min(100, Math.max(0, percent)),
			resetInSec: parseDurationToSec(resetText) ?? 0,
			status: percent >= 100 ? "rate-limited" : "ok"
		});
	}
	return windows;
}

async function fetchOcgo(cfg, timeoutMs) {
	if (cfg.cookie === undefined || cfg.workspaceID === undefined) {
		throw new UsageError("missing cookie or workspaceID", "noconfig");
	}
	const url = cfg.baseUrl.replace(/\/+$/, "") + "/workspace/" + encodeURIComponent(cfg.workspaceID) + "/go";
	const html = await fetchText(url, { Cookie: cfg.cookie, Accept: "text/html" }, timeoutMs, [cfg.cookie]);
	const windows = parseOcgoSSR(html);
	if (windows.length === 0) {
		throw new UsageError("usage page parsed empty (cookie expired or invalid?)", "http302");
	}
	return { kind: "percent-windows", windows };
}

// ── deepseek: balance API ────────────────────────────────────────────────────

const formatMoney = (value, currency) => {
	const amount = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return currency === "CNY" ? "¥" + amount : currency === "USD" ? "$" + amount : amount + " " + currency;
};

const asNumber = (value) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
};

async function fetchDeepSeek(cfg, timeoutMs) {
	if (cfg.apiKey === undefined) throw new UsageError("missing DEEPSEEK_API_KEY", "noconfig");
	const body = await fetchJson(
		DEEPSEEK_BALANCE_URL,
		{ Authorization: "Bearer " + cfg.apiKey, Accept: "application/json", "User-Agent": "dsh-usage-suite" },
		timeoutMs,
		[cfg.apiKey]
	);
	const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
	const notes = [];
	let balance = undefined;
	for (const entry of infos) {
		if (entry === null || typeof entry !== "object") continue;
		const currency = typeof entry.currency === "string" ? entry.currency : undefined;
		const total = asNumber(entry.total_balance);
		if (currency !== undefined && total !== undefined) {
			balance = { amount: total, currency };
			const granted = asNumber(entry.granted_balance);
			if (granted !== undefined && granted > 0) notes.push("granted " + formatMoney(granted, currency));
			const toppedUp = asNumber(entry.topped_up_balance);
			if (toppedUp !== undefined && toppedUp > 0) notes.push("topped up " + formatMoney(toppedUp, currency));
		}
	}
	if (balance === undefined) throw new UsageError("balance endpoint returned no displayable data", "parse");
	if (body?.is_available === false) notes.push("balance insufficient for API calls");
	return { kind: "balance", balance, notes };
}

// ── zhipu: GLM Coding Plan quota API ─────────────────────────────────────────

async function fetchZhipu(cfg, timeoutMs) {
	if (cfg.apiKey === undefined) throw new UsageError("missing ZAI_CODING_CN_API_KEY", "noconfig");
	// The CN monitor endpoint expects the RAW key in Authorization (no Bearer).
	const body = await fetchJson(
		ZHIPU_QUOTA_URL,
		{
			Authorization: cfg.apiKey,
			Accept: "application/json",
			"Accept-Language": "en-US,en",
			"Content-Type": "application/json",
			"User-Agent": "dsh-usage-suite"
		},
		timeoutMs,
		[cfg.apiKey]
	);
	const payload = body?.data !== null && typeof body?.data === "object" ? body.data : undefined;
	if (payload === undefined) {
		const msg = typeof body?.msg === "string" && body.msg.length > 0 ? redact(truncate(body.msg, 200), [cfg.apiKey]) : "no data";
		throw new UsageError("zhipu quota endpoint: " + msg, "parse");
	}
	const limits = Array.isArray(payload.limits) ? payload.limits : [];
	const windows = [];
	for (const entry of limits) {
		if (entry === null || typeof entry !== "object") continue;
		if (entry.type !== "TOKENS_LIMIT") continue;
		const used = asNumber(entry.percentage);
		if (used === undefined) continue;
		const resetsAtMs = asNumber(entry.nextResetTime);
		windows.push({
			key: "tokens5h",
			label: "5h tokens",
			kind: "percent",
			percent: Math.min(100, Math.max(0, used)),
			resetInSec: resetsAtMs !== undefined ? Math.max(0, Math.round((resetsAtMs - Date.now()) / 1000)) : 0,
			status: used >= 100 ? "rate-limited" : "ok"
		});
	}
	if (windows.length === 0) throw new UsageError("quota endpoint returned no TOKENS_LIMIT window", "parse");
	const notes = [];
	if (typeof payload.level === "string" && payload.level.length > 0) notes.push("plan " + payload.level);
	return { kind: "percent-windows", windows, notes };
}

// ── service: cache + views ───────────────────────────────────────────────────

const FETCHERS = { ocgo: fetchOcgo, deepseek: fetchDeepSeek, zhipu: fetchZhipu };

/** Per-provider cached read (view or structured error). */
export class UsageSuiteService {
	constructor(options = {}) {
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		/** @type {Map<string, {at: number, view?: object, error?: {code: string, message: string}}>} */
		this.state = new Map();
	}

	/**
	 * Read one provider. Cached while fresh; failures cool down; `force`
	 * bypasses both. Never throws: errors are returned as values.
	 */
	async view(provider, { force = false } = {}) {
		if (!PROVIDERS.includes(provider)) {
			return { ok: false, provider, error: { code: "unknown", message: "unknown provider " + provider } };
		}
		const cached = this.state.get(provider);
		const now = Date.now();
		if (!force && cached !== undefined) {
			const age = now - cached.at;
			if (cached.view !== undefined && age < this.cacheTtlMs) {
				return { ok: true, provider, updatedAt: cached.at, data: cached.view };
			}
			if (cached.error !== undefined && age < this.cooldownMs) {
				return { ok: false, provider, updatedAt: cached.at, error: cached.error };
			}
		}
		const cfg = resolveProviderConfig(provider);
		try {
			const data = await FETCHERS[provider](cfg, this.timeoutMs);
			const at = Date.now();
			this.state.set(provider, { at, view: data });
			return { ok: true, provider, updatedAt: at, data };
		} catch (error) {
			const at = Date.now();
			const wrapped = error instanceof UsageError
				? { code: error.code, message: error.message }
				: { code: "internal", message: redact(String(error?.message ?? error), [cfg.cookie, cfg.apiKey].filter(Boolean)) };
			this.state.set(provider, { at, error: wrapped });
			return { ok: false, provider, updatedAt: at, error: wrapped };
		}
	}

	/** Drop every cached read (used after a config write). */
	invalidate() {
		this.state.clear();
	}

	/** Masked (browser-safe) view of the effective config. */
	configView() {
		const mask = (value) => value === undefined
			? { set: false, tail: "" }
			: { set: true, tail: value.length > 4 ? value.slice(-4) : "" };
		const ocgo = resolveProviderConfig("ocgo");
		const deepseek = resolveProviderConfig("deepseek");
		const zhipu = resolveProviderConfig("zhipu");
		return {
			ocgo: { workspaceID: mask(ocgo.workspaceID), cookie: mask(ocgo.cookie) },
			deepseek: { apiKey: mask(deepseek.apiKey) },
			zhipu: { apiKey: mask(zhipu.apiKey) }
		};
	}

	/**
	 * Merge a partial config into $DSH_HOME/usage-suite.json. Only keys
	 * present in the partial are touched; null/empty clears a field.
	 */
	writeConfig(partial) {
		const path = join(dshHome(), "usage-suite.json");
		const next = readJsonIfExists(path) ?? {};
		for (const provider of PROVIDERS) {
			const section = partial?.[provider];
			if (section === null || typeof section !== "object") continue;
			next[provider] = next[provider] ?? {};
			for (const field of Object.keys(section)) {
				const value = section[field];
				if (field === "cookie") {
					const normalized = typeof value === "string" ? normalizeCookie(value) : undefined;
					if (normalized !== undefined) next[provider][field] = normalized;
					else delete next[provider][field];
				} else if (typeof value === "string" && value.trim().length > 0) {
					next[provider][field] = value.trim();
				} else {
					delete next[provider][field];
				}
			}
		}
		writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
		this.invalidate();
		return this.configView();
	}
}

// ── HTTP routes ──────────────────────────────────────────────────────────────

const API_PREFIX = "/api/model-usage";

const sendJson = (res, status, value) => {
	const body = JSON.stringify(value);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
	res.end(body);
};

/** Read a bounded JSON request body (POST /config). */
async function readJsonBody(req) {
	return await new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				reject(new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			if (raw.length === 0) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(new Error("bad-json"));
			}
		});
		req.on("error", reject);
	});
}

/** Build the full route family for one service instance. */
export function makeUsageRoutes(service) {
	return [
		{
			kind: "exact",
			path: API_PREFIX,
			handler: async (req, res) => {
				if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method-not-allowed" });
				const url = new URL(req.url, "http://localhost");
				const provider = url.searchParams.get("provider") ?? undefined;
				if (provider !== undefined) {
					sendJson(res, 200, await service.view(provider));
					return;
				}
				const all = {};
				for (const key of PROVIDERS) all[key] = await service.view(key);
				sendJson(res, 200, { ok: true, providers: all });
			}
		},
		{
			kind: "exact",
			path: API_PREFIX + "/refresh",
			handler: async (req, res) => {
				if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method-not-allowed" });
				const url = new URL(req.url, "http://localhost");
				const provider = url.searchParams.get("provider") ?? undefined;
				if (provider === undefined || !PROVIDERS.includes(provider)) {
					sendJson(res, 400, { ok: false, error: "provider query parameter required (ocgo|deepseek|zhipu)" });
					return;
				}
				sendJson(res, 200, await service.view(provider, { force: true }));
			}
		},
		{
			kind: "exact",
			path: API_PREFIX + "/config",
			handler: async (req, res) => {
				if (req.method === "GET") {
					sendJson(res, 200, { ok: true, config: service.configView() });
					return;
				}
				if (req.method === "POST") {
					try {
						const body = await readJsonBody(req);
						if (body === null || typeof body !== "object" || Array.isArray(body)) {
							sendJson(res, 400, { ok: false, error: "body must be a JSON object" });
							return;
						}
						sendJson(res, 200, { ok: true, config: service.writeConfig(body) });
					} catch (error) {
						sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
					}
					return;
				}
				sendJson(res, 405, { ok: false, error: "method-not-allowed" });
			}
		}
	];
}

// ── plugin entry ─────────────────────────────────────────────────────────────

/**
 * Register the usage service and its API routes.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context.
 * @param {{cacheTtlMs?: number, cooldownMs?: number, timeoutMs?: number}} config - row config.
 */
export function apply(ctx, config = {}) {
	const service = new UsageSuiteService(config);
	const routes = makeUsageRoutes(service);
	ctx.effect(() => {
		const disposers = routes.map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "usage-suite: routes");
	ctx.logger?.info?.("usage-suite: mounted /api/model-usage routes");
}
