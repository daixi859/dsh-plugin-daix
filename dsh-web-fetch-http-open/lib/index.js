// dsh-web-fetch-http-open — host 插件（官方规范：命名导出 name/inject/Config/apply，无 default export）
//
// web_fetch 的取数链路：dsh-tool-web 的 web_fetch 工具 → ctx.web.fetch() → 按配置选中的 fetch provider。
// 内置 provider（@deepseek-ai/dsh-web-fetch-http，id=http）在 DNS 解析后强制要求答案集全部为
// 公网单播地址，否则抛 WEB_BLOCKED_URL（见其 resolvePublicAddresses / isPublicIpAddress）。
// 本插件注册 id=http-open 的 provider，除“跳过公网 IP 校验”外与官方 web_fetch 行为一致：
//
// - 首选路径：从宿主运行时（桌面宿主进程 argv 中携带的 dsh 安装目录，即 app.asar 内的
//   dsh/）定位并 import 官方 @deepseek-ai/dsh-web-fetch-http，用
//   `new HttpFetchProvider(limits, resolveOpenAddresses)` 直接实例化官方类 —— 构造器第二
//   参数本来就是 resolver 注入点（原代码注释注明“overridden only by focused tests”），
//   于是重定向、字节/字符上限、charset 解码、超时、undici 地址固定全部是官方原码；
//   仅实例 id 改为 http-open，避开 ctx.web 的 WEB_DUPLICATE_PROVIDER。
// - 兜底路径：宿主模块不可定位时，用下面内置的一份行为等价实现（同样的 URL 校验、
//   同源重定向、上限与错误码；传输为全局 fetch —— 地址固定只在“先校验后连接”的
//   TOCTOU 防护里有意义，跳过校验后无需固定；代理策略同样省略）。
// - WebError：优先 import 宿主 @deepseek-ai/dsh-web 的同一个类，保证错误码能像内置
//   provider 一样结构化进入工具结果；定位失败时退回本地等价类（消息一致）。
//
// 安全提示：公网校验是为防 SSRF 的 —— 模型选择的 URL 不应摸到本机/内网服务。启用本
// 插件即表示接受 web_fetch 可以访问 127.0.0.1、局域网等非公网地址。

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const name = "web-fetch-http-open";
export const inject = ["web"];

/** 无 schema；apply 内手动校验并取默认值（与官方默认一致）。 */
export const Config = undefined;

const PROVIDER_ID = "http-open";
const MAX_NODE_TIMER_DELAY_MS = 2147483647;
const DEFAULT_USER_AGENT = "deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)";

// ── WebError：默认本地类；定位到宿主 @deepseek-ai/dsh-web 后升级为同一个类。 ──────

let WebErrorClass = class LocalWebError extends Error {
	constructor(message, code, options) {
		super(message, options);
		this.name = "WebError";
		this.code = code;
	}
};
function WebError(message, code, options) {
	return new WebErrorClass(message, code, options);
}

// ── 宿主模块定位 ──────────────────────────────────────────────────────────────
// 桌面宿主（dsh-desktop-host）以 process.argv[2] 携带 dsh 运行时目录（app.asar 内的
// dsh/），其 installAnchor 即 <运行时目录>/node_modules/@deepseek-ai/dsh/package.json。
// 宿主进程具备 asar 感知能力（应用自身的 ESM 包全部从 asar 内解析），因此对候选锚点
// createRequire().resolve() 再 import 即可拿到官方模块。

function hostManifestCandidates() {
	const found = [];
	const push = (candidate) => {
		if (candidate && !found.includes(candidate) && existsSync(candidate)) found.push(candidate);
	};
	for (const arg of process.argv ?? []) {
		if (typeof arg !== "string" || arg.length === 0) continue;
		if (/node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]package\.json$/i.test(arg)) push(arg);
		push(join(arg, "node_modules", "@deepseek-ai", "dsh", "package.json"));
		const at = arg.toLowerCase().lastIndexOf("app.asar");
		if (at >= 0) push(join(arg.slice(0, at), "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json"));
	}
	return found;
}

async function importHostPackage(specifier) {
	for (const anchor of hostManifestCandidates()) {
		try {
			const require = createRequire(anchor);
			const resolved = require.resolve(specifier);
			return await import(pathToFileURL(resolved).href);
		} catch {
			/* 换下一个锚点 */
		}
	}
	return undefined;
}

// ── “跳过公网校验”的解析器 ─────────────────────────────────────────────────────
// 与官方 resolvePublicAddresses 相同的解析流程与家族校验，仅去掉：
//   1) isPublicIpAddress 过滤（WEB_BLOCKED_URL 的来源）；
//   2) NAT64/DNS64 前缀检查（同样只服务于公网过滤）。
// 返回的地址集仍会交给官方传输做连接级固定（undici pinned lookup）。

/** WHATWG URL 保留 IPv6 主机名的方括号；IP 解析器不认。 */
function stripIpv6Brackets(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** 竞速一次不可取消的系统解析，避免它拖住工具取消。 */
function raceWithSignal(promise, signal) {
	const abortError = () => new Error("web fetch aborted during hostname resolution", { cause: signal.reason });
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => {
			reject(abortError());
		};
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}

async function resolveOpenAddresses(hostname, signal, resolver = lookup) {
	const unbracketed = stripIpv6Brackets(hostname);
	const literalFamily = isIP(unbracketed);
	const resolved = literalFamily === 0
		? await raceWithSignal(resolver(unbracketed, { all: true, order: "verbatim" }), signal)
		: [{ address: unbracketed, family: literalFamily }];
	if (resolved.length === 0) throw WebError(`hostname "${hostname}" resolved to no addresses`, "WEB_PROVIDER_ERROR");
	const addresses = [];
	for (const entry of resolved) {
		if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
			throw WebError(`hostname "${hostname}" resolved to an invalid IP address`, "WEB_PROVIDER_ERROR");
		}
		addresses.push({ address: entry.address, family: entry.family });
	}
	return addresses;
}

// ── 限额配置（默认值与官方 web-fetch-http 一致） ────────────────────────────────

function assertPositiveFinite(field, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`web-fetch-http-open: ${field} must be a positive finite number`);
}

function assertNonNegativeInteger(field, value) {
	if (!Number.isInteger(value) || value < 0) throw new Error(`web-fetch-http-open: ${field} must be a non-negative integer`);
}

function resolveLimits(config) {
	const raw = config ?? {};
	const limits = {
		maxResponseBytes: raw.maxResponseBytes ?? 5e6,
		maxBodyChars: raw.maxBodyChars ?? 1e5,
		timeoutMs: raw.timeoutMs ?? 3e4,
		maxRedirects: raw.maxRedirects ?? 5,
		userAgent: raw.userAgent ?? DEFAULT_USER_AGENT
	};
	assertPositiveFinite("maxResponseBytes", limits.maxResponseBytes);
	assertPositiveFinite("maxBodyChars", limits.maxBodyChars);
	assertPositiveFinite("timeoutMs", limits.timeoutMs);
	if (limits.timeoutMs > MAX_NODE_TIMER_DELAY_MS) throw new Error(`web-fetch-http-open: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
	assertNonNegativeInteger("maxRedirects", limits.maxRedirects);
	if (typeof limits.userAgent !== "string" || limits.userAgent.length === 0) throw new Error("web-fetch-http-open: userAgent must be a non-empty string");
	return limits;
}

// ── 兜底 provider（官方模块不可定位时使用） ─────────────────────────────────────
// URL 策略、同源重定向、字节/字符上限、charset、错误码均与官方 provider 一致；
// 传输用全局 fetch（Node 内置 undici），不做地址固定、不走代理策略。

/** 解析并校验请求 URL：仅 HTTP(S)、长度上限、不允许内嵌凭据。 */
function parseFetchUrl(input) {
	let url;
	try {
		url = new URL(input);
	} catch (error) {
		throw WebError(`invalid URL: ${input}`, "WEB_INVALID_URL", { cause: error });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, "WEB_INVALID_URL");
	if (url.username.length > 0 || url.password.length > 0) throw WebError("credentials in URLs are not allowed", "WEB_BLOCKED_URL");
	return url;
}

function validateFetchUrl(input) {
	if (input.length > 2048) throw WebError("URL exceeds the maximum length of 2048", "WEB_INVALID_URL");
	return parseFetchUrl(input);
}

/** 同源 = scheme、hostname、port 一致；跨源重定向拒绝，需重新发起调用。 */
function isSameOrigin(a, b) {
	return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}

/** 携带 Location 的重定向状态码。 */
function isRedirectStatus(status) {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirect(location, base) {
	try {
		return new URL(location, base);
	} catch (error) {
		throw WebError(`invalid redirect Location "${location}"`, "WEB_PROVIDER_ERROR", { cause: error });
	}
}

/** Content-Type → 可解码的 body 类型（html/text），不支持则 undefined。 */
function classifyContentType(contentType) {
	const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
	if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
	if (mime.startsWith("text/")) return "text";
	if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
}

function parseCharset(contentType) {
	return /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "")?.[1]?.trim().toLowerCase();
}

function decoderForCharset(charset) {
	if (charset === void 0) return new TextDecoder("utf-8");
	try {
		return new TextDecoder(charset);
	} catch (error) {
		throw WebError(`unsupported charset "${charset}"`, "WEB_UNSUPPORTED_CONTENT_TYPE", { cause: error });
	}
}

class FallbackFetchProvider {
	limits;
	id = PROVIDER_ID;

	constructor(limits) {
		this.limits = limits;
	}

	available() {
		return true;
	}

	async fetch(request, signal) {
		if (signal?.aborted) throw WebError("web fetch aborted", "WEB_ABORTED");
		const controller = new AbortController();
		const onOuterAbort = () => controller.abort(signal.reason);
		signal.addEventListener("abort", onOuterAbort, { once: true });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(WebError("web fetch timed out", "WEB_FETCH_TIMEOUT"));
		}, Math.min(this.limits.timeoutMs, MAX_NODE_TIMER_DELAY_MS));
		try {
			return await this.followAndRead(request.url, controller.signal);
		} catch (error) {
			const reason = controller.signal.reason;
			if (reason instanceof WebErrorClass && reason.code === "WEB_FETCH_TIMEOUT") {
				throw WebError("web fetch timed out", "WEB_FETCH_TIMEOUT", { cause: reason });
			}
			if (controller.signal.aborted && !timedOut) throw WebError("web fetch aborted", "WEB_ABORTED", { cause: error });
			if (error instanceof WebErrorClass) throw error;
			throw WebError(`web fetch failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", onOuterAbort);
		}
	}

	/** 同源重定向跟随至 hop 上限，再读最终响应。 */
	async followAndRead(initialUrl, signal) {
		let currentUrl = validateFetchUrl(initialUrl);
		let redirectsFollowed = 0;
		for (;;) {
			const response = await this.requestOnce(currentUrl, signal);
			if (isRedirectStatus(response.status)) {
				if (redirectsFollowed >= this.limits.maxRedirects) {
					await response.body?.cancel();
					throw WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, "WEB_REDIRECT_BLOCKED");
				}
				const location = response.headers.get("location");
				if (location === null) {
					await response.body?.cancel();
					throw WebError(`redirect response (HTTP ${response.status}) without a Location header`, "WEB_PROVIDER_ERROR");
				}
				const target = resolveRedirect(location, currentUrl);
				let validatedTarget;
				try {
					validatedTarget = validateFetchUrl(target.toString());
					if (!isSameOrigin(validatedTarget, currentUrl)) {
						throw WebError(`cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`, "WEB_REDIRECT_BLOCKED");
					}
				} catch (error) {
					await response.body?.cancel();
					throw error;
				}
				await response.body?.cancel();
				currentUrl = validatedTarget;
				redirectsFollowed++;
				continue;
			}
			return await this.readBody(response, currentUrl, signal);
		}
	}

	async requestOnce(url, signal) {
		return fetch(url, {
			method: "GET",
			redirect: "manual",
			headers: {
				"user-agent": this.limits.userAgent,
				"accept": "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8"
			},
			signal
		});
	}

	/** 读取、字节截断、分类并解码最终响应体。 */
	async readBody(response, finalUrl, signal) {
		const contentType = response.headers.get("content-type");
		const kind = classifyContentType(contentType);
		if (kind === void 0) {
			await response.body?.cancel();
			throw WebError(`unsupported content type "${contentType ?? "unknown"}"`, "WEB_UNSUPPORTED_CONTENT_TYPE");
		}
		let decoder;
		try {
			decoder = decoderForCharset(parseCharset(contentType));
		} catch (error) {
			await response.body?.cancel();
			throw error;
		}
		const { bytes, truncatedByBytes } = await this.readCapped(response, signal);
		const decoded = decoder.decode(bytes);
		const truncatedByChars = decoded.length > this.limits.maxBodyChars;
		const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded;
		const body = kind === "html" ? { kind: "html", content } : { kind: "text", content };
		return {
			url: finalUrl.toString(),
			statusCode: response.status,
			body,
			truncated: truncatedByBytes || truncatedByChars
		};
	}

	/** 读取响应流至 maxResponseBytes：Content-Length 超限立即拒绝；流式超限截断。 */
	async readCapped(response, signal) {
		void signal;
		const declared = response.headers.get("content-length");
		if (declared !== null) {
			const length = Number(declared);
			if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
				await response.body?.cancel();
				throw WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, "WEB_FETCH_TOO_LARGE");
			}
		}
		if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false };
		const chunks = [];
		let total = 0;
		let truncatedByBytes = false;
		const reader = response.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const remaining = this.limits.maxResponseBytes - total;
				if (value.byteLength > remaining) {
					chunks.push(value.subarray(0, remaining));
					total += remaining;
					truncatedByBytes = true;
					break;
				}
				chunks.push(value);
				total += value.byteLength;
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { bytes, truncatedByBytes };
	}
}

// ── 注册 ──────────────────────────────────────────────────────────────────────

export async function apply(ctx, config) {
	const limits = resolveLimits(config);
	const [official, webSeam] = await Promise.all([
		importHostPackage("@deepseek-ai/dsh-web-fetch-http"),
		importHostPackage("@deepseek-ai/dsh-web")
	]);
	if (typeof webSeam?.WebError === "function") WebErrorClass = webSeam.WebError;
	let provider;
	if (typeof official?.HttpFetchProvider === "function") {
		// 官方类 + 注入“不过滤公网”的 resolver：除 IP 校验外与官方 web_fetch 完全一致。
		provider = new official.HttpFetchProvider(limits, resolveOpenAddresses);
	} else {
		ctx.logger?.warn?.("web-fetch-http-open: 宿主 @deepseek-ai/dsh-web-fetch-http 不可定位，使用内置等价传输（无地址固定、无代理策略）。");
		provider = new FallbackFetchProvider(limits);
	}
	// 官方实例的 id 固定为 "http"；ctx.web 拒绝重复 id，故改为 http-open。
	provider.id = PROVIDER_ID;
	ctx.web.registerFetchProvider(provider);
}
