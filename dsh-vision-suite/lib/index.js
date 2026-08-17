// dsh-vision-suite — host half.
//
// Two cooperating host-plane facilities:
//
//   1. `recognize_image` — a model-facing tool over an OpenAI-compatible
//      vision Chat Completions API (default: Xiaomi MiMo). Accepts a local
//      path, an http(s) URL, or a base64 data URI plus an optional prompt.
//      Deep thinking defaults to disabled: image transcription measured
//      identical quality at ~4x fewer tokens with it off, and reasoning
//      tokens count toward max_tokens (a long CoT can starve the answer).
//      finish_reason is surfaced so a truncated or starved result is never
//      silently returned.
//
//   2. POST /paste-as-path/save — an exact webServer route the browser half
//      calls to save pasted image bytes or dropped file bytes under a temp
//      directory and get back the absolute path. Registered only when the
//      webServer service exists (Web surface); a TUI-only composition still
//      gets the tool.
//
// Credentials resolve per call: literal config apiKey > the credentials
// service (apiKeyEnv, the managed ~/.dsh/.credentials.yaml) > process env.
// Runtime peer modules (@deepseek-ai/schemastery, @deepseek-ai/dsh-tools)
// are provided by the harness installation this plugin is composed into.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

/** Cordis plugin name used by loader diagnostics. */
const name = "vision-suite";

/** Services required unconditionally: the tool registry and prompt sections. */
const inject = ["tools", "systemPrompt"];

// ── vision defaults ──────────────────────────────────────────────────────────
const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const DEFAULT_MODEL = "mimo-v2.5";
const DEFAULT_API_KEY_ENV = "VISION_API_KEY";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_THINKING = "disabled";

// ── paste-to-path defaults ───────────────────────────────────────────────────
const DEFAULT_DIRECTORY = join(tmpdir(), "dsh-paste");
const DEFAULT_MAX_PASTE_BYTES = 12 * 1024 * 1024;

const Config = z.object({
	baseURL: z.string().default(DEFAULT_BASE_URL),
	model: z.string().default(DEFAULT_MODEL),
	apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
	apiKey: z.string().role("secret"),
	maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
	timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
	maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
	thinking: z.union(["enabled", "disabled"]).default(DEFAULT_THINKING),
	directory: z.string().default(DEFAULT_DIRECTORY),
	maxPasteBytes: z.number().step(1).min(1).default(DEFAULT_MAX_PASTE_BYTES)
});

/** Local image extensions the tool accepts, mapped to media types. */
const MEDIA_BY_EXT = new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
	[".gif", "image/gif"],
	[".bmp", "image/bmp"]
]);

/** Known image media types to canonical file extensions (saved pastes). */
const EXT_BY_TYPE = new Map([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/webp", ".webp"],
	["image/gif", ".gif"]
]);

/** Common non-image media types to canonical extensions (name-less drops). */
const GENERIC_EXT_BY_TYPE = new Map([
	["application/pdf", ".pdf"],
	["application/json", ".json"],
	["application/xml", ".xml"],
	["application/zip", ".zip"],
	["application/javascript", ".js"],
	["application/octet-stream", ""],
	["text/plain", ".txt"],
	["text/html", ".html"],
	["text/css", ".css"],
	["text/csv", ".csv"],
	["text/markdown", ".md"]
]);

/** Default instruction when the model calls the tool without a prompt. */
const DEFAULT_PROMPT = "Please describe the content of this image in detail, and extract any visible text.";

// ── shared helpers ───────────────────────────────────────────────────────────

/**
 * Timestamped collision-free file name: img-YYYYMMDD-HHmmss-<rand><ext>.
 * @param {string} ext - the file extension including the leading dot.
 * @returns {string} the file base name.
 */
function timestampName(ext) {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	const stamp = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
		+ "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
	return "img-" + stamp + "-" + randomUUID().slice(0, 8) + ext;
}

/**
 * Resolve the extension for a media type. Known types map canonically; any
 * other type contributes a sanitized short extension from its subtype.
 * @param {string} mediaType - the media type.
 * @returns {string} the extension with a leading dot, or "" when unresolvable.
 */
function extensionFor(mediaType) {
	const known = EXT_BY_TYPE.get(mediaType);
	if (known !== undefined) return known;
	const generic = GENERIC_EXT_BY_TYPE.get(mediaType);
	if (generic !== undefined) return generic;
	const slash = mediaType.indexOf("/");
	const subtype = (slash >= 0 ? mediaType.slice(slash + 1) : mediaType)
		.replace(/[^a-z0-9]/gi, "").slice(0, 8);
	return subtype.length > 0 ? "." + subtype : "";
}

/**
 * Safe extension contributed by a client-supplied file name. Only the final
 * extension is trusted (never the directory part, which is ignored); the
 * saved file name itself is always server-generated.
 * @param {string} name - the original file name, or "".
 * @returns {string} a lowercase extension with a leading dot, or "" when the
 *   name is missing, hostile (separators / control chars), or extension-less.
 */
function safeNameExtension(name) {
	if (typeof name !== "string" || name.length === 0 || name.length > 255) return "";
	if (/[\\/\u0000-\u001f]/.test(name)) return "";
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "";
	const ext = name.slice(dot + 1);
	return /^[a-z0-9]{1,10}$/i.test(ext) ? "." + ext.toLowerCase() : "";
}

/** Send one JSON response and end the request. */
function sendJson(res, statusCode, value) {
	const body = JSON.stringify(value);
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}

/**
 * Read the request body as JSON under a byte ceiling. A declared
 * content-length over the ceiling rejects before transfer; the accumulated
 * total enforces it against an under-declaring or streaming peer.
 * @param {import("node:http").IncomingMessage} req - the route request.
 * @param {number} capBytes - maximum accepted body size.
 * @returns {Promise<unknown>} the parsed JSON value.
 * @throws with statusCode 413/400 on overflow or bad JSON.
 */
async function readJsonBody(req, capBytes) {
	const declared = Number(req.headers["content-length"] ?? NaN);
	if (Number.isFinite(declared) && declared > capBytes) {
		throw Object.assign(new Error("request body exceeds the size ceiling"), { statusCode: 413 });
	}
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > capBytes) {
			throw Object.assign(new Error("request body exceeds the size ceiling"), { statusCode: 413 });
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw Object.assign(new Error("request body is not valid JSON"), { statusCode: 400, cause: error });
	}
}

// ── recognize_image helpers ──────────────────────────────────────────────────

/**
 * Resolve the image reference the vision API receives: URLs and data URIs
 * pass through; local paths are read, size-capped, and inlined as a data URI.
 * @param {string} image - local path, http(s) URL, or data URI.
 * @param {number} maxImageBytes - cap on one locally read image.
 * @returns {Promise<string>} the image reference for the wire request.
 * @throws {Error} when the file is missing, too large, or of a refused type.
 */
async function buildImageRef(image, maxImageBytes) {
	if (image.startsWith("data:") || image.startsWith("http://") || image.startsWith("https://")) return image;
	const ext = extname(image).toLowerCase();
	const mediaType = MEDIA_BY_EXT.get(ext);
	if (mediaType === undefined) {
		throw new Error("recognize_image: unsupported image extension \"" + ext + "\"; accepted: " + [...MEDIA_BY_EXT.keys()].join(", "));
	}
	const info = await stat(image).catch(() => {
		throw new Error("recognize_image: image file not found: " + image);
	});
	if (!info.isFile()) throw new Error("recognize_image: not a regular file: " + image);
	if (info.size > maxImageBytes) {
		throw new Error("recognize_image: image is " + String(info.size) + " bytes, over the " + String(maxImageBytes) + "-byte ceiling");
	}
	const bytes = await readFile(image);
	return "data:" + mediaType + ";base64," + bytes.toString("base64");
}

/**
 * Extract the assistant text from an OpenAI-compatible chat response. Some
 * gateways return content as an array of typed parts; both shapes fold here.
 * @param {unknown} response - the parsed response body.
 * @returns {string} the joined text.
 * @throws {Error} when no text is present.
 */
function extractText(response) {
	const content = response?.choices?.[0]?.message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const joined = content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
		if (joined.length > 0) return joined;
	}
	throw new Error("recognize_image: the vision model returned no text content");
}

/**
 * One credential resolution against the per-call options.
 * @param {{apiKey?: string, apiKeyEnv: string, resolveApiKey: () => Promise<string | undefined>}} options - one call snapshot.
 * @returns {Promise<string>} the API key.
 * @throws {Error} naming the env var when no key resolves.
 */
async function resolveApiKeyOnce(options) {
	if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey;
	const resolved = await options.resolveApiKey();
	if (resolved !== undefined && resolved.length > 0) return resolved;
	throw new Error("recognize_image: no API key; store \"" + options.apiKeyEnv + "\" in ~/.dsh/.credentials.yaml, export it, or set a literal apiKey in the vision plugin config");
}

// ── plugin body ──────────────────────────────────────────────────────────────

/**
 * Register the recognize_image tool, its system-prompt guidance, and — when
 * the Web surface is composed — the paste-save route.
 *
 * The route uses `ctx.inject`, NOT a one-shot `ctx.get`: cordis re-evaluates
 * declared inject dependencies when services come online (see Registry.notify),
 * while a plain get at activation time silently misses a later-starting
 * webServer and the route never registers (observed as HTTP 405 from the SPA
 * static fallback answering POST). The callback receives a context that
 * already carries the service, and cordis disposes it with the plugin.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context.
 * @param {object} config - resolved plugin config (see {@link Config}).
 */
function apply(ctx, config) {
	applyVisionTool(ctx, config);
	ctx.inject(["webServer"], (webCtx) => {
		applySaveRoute(webCtx, config, webCtx.webServer);
	});
}

/** Register the model-facing recognize_image tool. */
function applyVisionTool(ctx, config) {
	const resolveOptions = () => ({
		apiKey: config.apiKey,
		apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== undefined) {
				const entry = await credentials.resolve(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
				if (entry?.value !== undefined && entry.value.length > 0) return entry.value;
			}
			const ambient = process.env[config.apiKeyEnv ?? DEFAULT_API_KEY_ENV];
			return ambient !== undefined && ambient.length > 0 ? ambient : undefined;
		},
		baseURL: config.baseURL ?? DEFAULT_BASE_URL,
		model: config.model ?? DEFAULT_MODEL,
		maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
		maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
		thinking: config.thinking ?? DEFAULT_THINKING
	});

	ctx.systemPrompt.section({
		name: "tool:recognize_image",
		order: 112,
		text: "Use the recognize_image tool to interpret an image with a dedicated vision model. It accepts a local file path (for example one pasted into the composer, or produced when the user drags a file into it), an http(s) URL, or a base64 data URI, plus an optional instruction prompt (describe, OCR/extract text, interpret a chart, analyze a UI screenshot, identify objects). Prefer it whenever the user supplies an image path or URL and wants it understood, and tailor the prompt to the asked-for outcome. Give high-resolution sources when available and ask narrow verbatim questions for critical numbers."
	});

	ctx.tools.register(defineTool({
		name: "recognize_image",
		description: "Recognize and interpret an image with a vision model. Pass a local file path, an http(s) URL, or a base64 data URI, and an optional instruction prompt; returns the text the vision model produces.",
		parameters: {
			image: {
				type: "string",
				required: true,
				description: "The image to interpret: a local file path, an http(s) URL, or a base64 data URI."
			},
			prompt: {
				type: "string",
				description: "Optional instruction for the vision model, e.g. \"extract all text\", \"describe the chart\". Defaults to a detailed description."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					text: { type: "string", required: true },
					model: { type: "string", required: true },
					image: { type: "string", required: true }
				}
			},
			render: (_args, value) => [{ type: "text", text: value.text }]
		},
		timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const image = args.image.trim();
			if (image.length === 0) throw new Error("recognize_image: image must be a non-empty string");
			const prompt = args.prompt !== undefined && args.prompt.trim().length > 0 ? args.prompt.trim() : DEFAULT_PROMPT;
			const options = resolveOptions();
			const apiKey = await resolveApiKeyOnce(options);
			const imageRef = await buildImageRef(image, options.maxImageBytes);

			const endpoint = options.baseURL.replace(/\/+$/, "") + "/chat/completions";
			let response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					redirect: "error",
					headers: {
						"authorization": "Bearer " + apiKey,
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify({
						model: options.model,
						...(options.thinking !== undefined ? { thinking: { type: options.thinking } } : {}),
						messages: [{
							role: "user",
							content: [
								{ type: "text", text: prompt },
								{ type: "image_url", image_url: { url: imageRef } }
							]
						}],
						max_tokens: options.maxTokens
					}),
					...(exec.signal !== undefined ? { signal: exec.signal } : {})
				});
			} catch (error) {
				if (exec.signal?.aborted === true) throw error;
				throw new Error("recognize_image: vision request failed: " + String(error?.message ?? error));
			}

			if (!response.ok) {
				let detail = "";
				try {
					const parsed = await response.json();
					detail = typeof parsed?.error === "string" ? parsed.error : parsed?.error?.message ?? parsed?.message ?? "";
				} catch {}
				const hint = response.status === 401 || response.status === 403
					? " (check the vision API key)"
					: response.status === 429 ? " (rate limited; retry later)" : "";
				throw new Error("recognize_image: vision API HTTP " + String(response.status) + hint + (detail.length > 0 ? ": " + detail : ""));
			}

			let parsed;
			try {
				parsed = await response.json();
			} catch (error) {
				throw new Error("recognize_image: vision API returned an unprocessable body: " + String(error?.message ?? error));
			}
			const finishReason = parsed?.choices?.[0]?.finish_reason;
			let text = extractText(parsed);
			if (text.length === 0 && finishReason === "length") {
				throw new Error("recognize_image: the vision model spent the whole " + String(options.maxTokens) + "-token budget on reasoning before writing any answer; raise maxTokens in the vision plugin config or ask a narrower question");
			}
			if (finishReason === "length") {
				text += "\n\n[recognize_image: output truncated at the " + String(options.maxTokens) + "-token limit (reasoning counts toward max_tokens); ask a narrower question or raise maxTokens]";
			}
			return { text, model: options.model, image };
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.image ?? "",
			kind: "vision",
			rawInput: args.prompt ?? ""
		})
	}));
}

/**
 * Register the file-save route on the Web surface HTTP carrier. Both the
 * paste flow (images) and the drop flow (any file type) POST to it; the
 * server always generates the saved file name, so client input only
 * contributes an extension at most.
 */
function applySaveRoute(ctx, config, webServer) {
	const directory = config.directory ?? DEFAULT_DIRECTORY;
	const maxBytes = config.maxPasteBytes ?? DEFAULT_MAX_PASTE_BYTES;
	const removeRoute = webServer.register({
		kind: "exact",
		path: "/paste-as-path/save",
		handler: async (req, res) => {
			try {
				if (req.method !== "POST") {
					sendJson(res, 405, { ok: false, error: "method not allowed; POST only" });
					return;
				}
				const contentType = String(req.headers["content-type"] ?? "");
				if (!contentType.toLowerCase().startsWith("application/json")) {
					sendJson(res, 415, { ok: false, error: "content-type must be application/json" });
					return;
				}
				const origin = req.headers.origin;
				if (origin !== undefined) {
					let originHost = null;
					try {
						originHost = new URL(origin).host;
					} catch {
						originHost = null;
					}
					if (originHost === null || originHost !== req.headers.host) {
						sendJson(res, 403, { ok: false, error: "cross-origin request refused" });
						return;
					}
				}

				const body = await readJsonBody(req, maxBytes * 2 + 65536);
				if (typeof body !== "object" || body === null || Array.isArray(body)) {
					sendJson(res, 400, { ok: false, error: "body must be a JSON object" });
					return;
				}
				const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
				if (mediaType.length > 64) {
					sendJson(res, 400, { ok: false, error: "mediaType must be a string under 64 characters" });
					return;
				}
				const name = typeof body.name === "string" ? body.name : "";
				const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
				const bytes = Buffer.from(dataBase64, "base64");
				if (bytes.length === 0) {
					sendJson(res, 400, { ok: false, error: "dataBase64 did not decode to any bytes" });
					return;
				}
				if (bytes.length > maxBytes) {
					sendJson(res, 413, { ok: false, error: "file exceeds the " + String(maxBytes) + "-byte ceiling" });
					return;
				}

				await mkdir(directory, { recursive: true });
				const extension = safeNameExtension(name) || extensionFor(mediaType) || ".bin";
				const file = join(directory, timestampName(extension));
				await writeFile(file, bytes);
				ctx.logger.info("vision-suite: saved " + String(bytes.length) + " bytes to " + file);
				sendJson(res, 200, { ok: true, path: file, bytes: bytes.length });
			} catch (error) {
				const statusCode = error?.statusCode ?? (error instanceof SyntaxError ? 400 : 500);
				if (statusCode === 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
				if (res.headersSent) {
					res.destroy();
					return;
				}
				sendJson(res, statusCode, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});
	ctx.effect(() => removeRoute, "vision-suite.saveRoute");
}

export {
	Config,
	DEFAULT_API_KEY_ENV,
	DEFAULT_BASE_URL,
	DEFAULT_MODEL,
	DEFAULT_THINKING,
	apply,
	buildImageRef,
	extensionFor,
	extractText,
	inject,
	name,
	safeNameExtension,
	timestampName
};
