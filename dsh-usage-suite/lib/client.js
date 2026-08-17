// dsh-usage-suite — browser half.
//
// One chip in the composer dock band (`conversation.composer.dock`) showing
// the usage of the session's CURRENT provider only:
//
//   opencode-go  → OpenCode Go   (5h / wk / mo percent windows)
//   deepseek     → DeepSeek      (¥ balance)
//   zai-coding-cn→ GLM Plan      (5h token window)
//
// Two hard rules drive the data flow:
//
//   1. On-demand: the host endpoint is called only for the provider the
//      session currently uses. The other two are never fetched.
//   2. No polling: there is no timer. Fetches happen on mount, on
//      turn/start + turn/end session events (turn/start only re-resolves
//      the provider so the chip swaps when the model switches; turn/end
//      fetches the usage), on provider change, and on manual refresh.
//
// Turn events ride the connection mux stream: one shared subscription is
// opened while at least one dock entry is mounted and closed when the last
// unmounts.

window.__ModuleLoader__.load({
	id: "dsh-usage-suite",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect, useRef, useCallback } = React;

		// ── provider mapping ──────────────────────────────────────────────────

		/** Map a dsh session provider id to this suite's usage provider. */
		function providerToUsage(provider) {
			if (typeof provider !== "string" || provider.length === 0) return undefined;
			if (provider === "opencode-go" || provider.startsWith("opencode-go/")) return "ocgo";
			// dsh's built-in DeepSeek provider is `deepseek-official`; keep the
			// bare `deepseek` spellings for custom provider configs.
			if (provider === "deepseek-official" || provider.startsWith("deepseek-official/")
				|| provider === "deepseek" || provider.startsWith("deepseek/")) return "deepseek";
			if (provider === "zai-coding-cn" || provider.startsWith("zai-coding-cn/")) return "zhipu";
			return undefined;
		}

		// ── host API (same-origin JSON) ───────────────────────────────────────

		async function musageFetch(path, init) {
			const response = await fetch(path, init);
			if (!response.ok) throw new Error("usage-suite " + path + " failed: " + String(response.status));
			return await response.json();
		}
		const musageApi = {
			view: (provider) => musageFetch("/api/model-usage?provider=" + encodeURIComponent(provider)),
			refresh: (provider) => musageFetch("/api/model-usage/refresh?provider=" + encodeURIComponent(provider)),
			config: () => musageFetch("/api/model-usage/config"),
			writeConfig: (partial) => musageFetch("/api/model-usage/config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(partial)
			})
		};

		// ── shared turn-event watcher (one mux stream for all chips) ──────────

		/** Browser-safe UUID (crypto.randomUUID needs a secure context). */
		function randomUuid() {
			const bytes = new Uint8Array(16);
			crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6] & 0x0f) | 0x40;
			bytes[8] = (bytes[8] & 0x3f) | 0x80;
			const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
			return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
		}

		/** sessionId → Set<callback(eventType)>. */
		const turnSubs = new Map();
		let muxController = null;
		let muxRetryTimer = null;
		let connectionHandle = null;
		let modelDirectoriesHandle = null;

		function scheduleMuxRetry() {
			if (muxRetryTimer !== null || turnSubs.size === 0) return;
			muxRetryTimer = setTimeout(() => {
				muxRetryTimer = null;
				ensureMuxStream();
			}, 5000);
		}

		function ensureMuxStream() {
			if (muxController !== null || turnSubs.size === 0) return;
			const handle = connectionHandle;
			const events = handle?.api?.events;
			if (events === undefined || typeof events.mux !== "function") {
				scheduleMuxRetry();
				return;
			}
			muxController = new AbortController();
			const controller = muxController;
			(async () => {
				const stream = events.mux({ rpcId: randomUuid(), payload: {} }, controller.signal);
				for await (const frame of stream) {
					const payload = frame?.payload;
					if (payload?.type === "session/event" && typeof payload.sessionId === "string") {
						const type = payload.event?.type;
						if (type === "turn/start" || type === "turn/end") {
							const subs = turnSubs.get(payload.sessionId);
							if (subs !== undefined) {
								for (const callback of [...subs]) {
									try {
										callback(type);
									} catch {}
								}
							}
						}
					}
				}
			})().catch(() => {}).finally(() => {
				if (muxController === controller) muxController = null;
				scheduleMuxRetry();
			});
		}

		/**
		 * Subscribe to turn lifecycle events for one session.
		 * @returns {() => void} unsubscribe.
		 */
		function subscribeTurns(sessionId, callback) {
			let set = turnSubs.get(sessionId);
			if (set === undefined) {
				set = new Set();
				turnSubs.set(sessionId, set);
			}
			set.add(callback);
			ensureMuxStream();
			return () => {
				const current = turnSubs.get(sessionId);
				if (current === undefined) return;
				current.delete(callback);
				if (current.size === 0) turnSubs.delete(sessionId);
				if (turnSubs.size === 0) {
					if (muxRetryTimer !== null) {
						clearTimeout(muxRetryTimer);
						muxRetryTimer = null;
					}
					if (muxController !== null) {
						muxController.abort();
						muxController = null;
					}
				}
			};
		}

		/**
		 * Push subscription for model-provider switches. The composer model seat
		 * keeps a shared per-session ModelDirectory (client service
		 * "modelDirectories"); the picker writes its selection there the instant
		 * the user switches models. Fires the callback only when the provider of
		 * record actually changes — no polling, no extra RPC (the authoritative
		 * re-resolve still rides the existing session.models call). When the
		 * service is unavailable this is a no-op and the chip keeps its
		 * turn-driven refresh.
		 * @returns {() => void} unsubscribe, or undefined when unavailable.
		 */
		function subscribeProviderSwitches(sessionId, callback) {
			const resolver = modelDirectoriesHandle;
			if (resolver === null || typeof resolver.directoryFor !== "function") return undefined;
			let directory;
			try {
				directory = resolver.directoryFor(sessionId);
			} catch {
				return undefined;
			}
			if (directory === undefined || typeof directory.subscribe !== "function" || typeof directory.getSnapshot !== "function") {
				return undefined;
			}
			let last = undefined;
			let armed = false;
			const emit = (notify) => {
				const provider = directory.getSnapshot()?.current?.provider;
				if (armed && provider !== last) {
					try {
						callback(provider);
					} catch {}
				}
				last = provider;
				armed = true;
			};
			emit(false);
			const stop = directory.subscribe(() => emit(true));
			return typeof stop === "function" ? stop : undefined;
		}

		// ── formatting helpers ────────────────────────────────────────────────

		function formatDuration(totalSec) {
			if (!Number.isFinite(totalSec)) return "";
			if (totalSec < 60) return String(Math.max(0, Math.floor(totalSec))) + "s";
			if (totalSec < 3600) return String(Math.floor(totalSec / 60)) + "m";
			if (totalSec < 86400) {
				const h = Math.floor(totalSec / 3600);
				const m = Math.floor((totalSec % 3600) / 60);
				return m > 0 ? h + "h " + m + "m" : h + "h";
			}
			const d = Math.floor(totalSec / 86400);
			const h = Math.floor((totalSec % 86400) / 3600);
			return h > 0 ? d + "d " + h + "h" : d + "d";
		}

		function formatClock(epochMs) {
			const d = new Date(epochMs);
			return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
		}

		function formatMoney(value, currency) {
			const amount = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			return currency === "CNY" ? "¥" + amount : currency === "USD" ? "$" + amount : amount + " " + currency;
		}

		/** Balance below which the DeepSeek chip turns warning-colored (CNY). */
		const LOW_BALANCE_CNY = 10;

		const MASK = "••••";
		const maskedText = (secret) => secret !== undefined && secret.set && secret.tail.length > 0 ? MASK + secret.tail : "";

		// ── chip UI ────────────────────────────────────────────────────────────

		const css = [
			".mus_wrap{display:inline-flex;position:relative}",
			".mus_chip{border:1px solid var(--dsw-alias-border-l2,#80808059);background:0 0;height:22px;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;white-space:nowrap;user-select:none;border-radius:999px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:1;display:inline-flex}",
			".mus_chip:hover,.mus_chipOpen{border-color:var(--dsw-alias-state-business-primary,#50a0ffb3)}",
			".mus_seg{align-items:baseline;gap:3px;display:inline-flex}",
			".mus_segSep{opacity:.45}",
			".mus_segWarn{color:var(--dsw-alias-state-warn-primary,#d29922)}",
			".mus_segErr{color:var(--dsw-alias-state-error-primary,#e5534b)}",
			".mus_details{z-index:40;border:1px solid var(--dsw-alias-border-inverted,#80808059);background:var(--dsw-specific-menu,#1f1f1f);min-width:220px;color:var(--dsw-alias-label-secondary,inherit);border-radius:12px;flex-direction:column;gap:6px;padding:8px 10px;font-size:12px;display:flex;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);box-shadow:var(--dsw-shadow-lv3,0 4px 12px #0000004d)}",
			".mus_window{justify-content:space-between;align-items:center;gap:12px;display:flex}",
			".mus_windowLabel{color:var(--dsw-alias-label-tertiary,inherit);align-items:center;gap:6px;display:inline-flex}",
			".mus_windowValue{font-variant-numeric:tabular-nums;align-items:baseline;gap:6px;display:inline-flex}",
			".mus_windowReset{opacity:.65;font-variant-numeric:tabular-nums;font-size:11px}",
			".mus_note{color:var(--dsw-alias-label-tertiary,inherit);opacity:.7}",
			".mus_foot{border-top:1px solid var(--dsw-alias-border-l1,#80808040);justify-content:space-between;align-items:center;gap:8px;padding-top:6px;font-size:11px;display:flex}",
			".mus_footRight{align-items:center;gap:8px;margin-left:auto;display:inline-flex}",
			".mus_setBtn{color:var(--dsw-alias-state-business-primary,#50a0ffe6);cursor:pointer;background:0 0;border:0;padding:0;font-size:11px}",
			".mus_setBtn:hover{text-decoration:underline}",
			".mus_fetchedAt{color:var(--dsw-alias-label-tertiary,inherit);opacity:.6}",
			".mus_refreshBtn{color:var(--dsw-alias-state-business-primary,#50a0ffe6);cursor:pointer;background:0 0;border:0;padding:0;font-size:11px}",
			".mus_refreshBtn:hover{text-decoration:underline}",
			".mus_field{flex-direction:column;gap:3px;display:flex}",
			".mus_fieldLabel{color:var(--dsw-alias-label-tertiary,inherit);opacity:.7}",
			".mus_fieldInput{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-specific-input-major,rgba(255,255,255,.06));caret-color:var(--dsw-alias-state-business-primary,#50a0ff);border:1px solid var(--dsw-alias-border-l2,#80808059);border-radius:6px;padding:3px 6px;font-size:12px;min-width:200px}",
			".mus_fieldInput::placeholder{color:var(--dsw-alias-label-tertiary,#808080);opacity:.7}",
			".mus_setPanel{flex-direction:column;gap:8px;display:flex}",
			".mus_setHint{color:var(--dsw-alias-label-tertiary,inherit);opacity:.55;font-size:11px}"
		].join("\n");
		const cssTag = "dsh-usage-suite/chip.css";
		if (typeof document !== "undefined"
			&& document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTag) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-suite";
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const SHORT_WINDOW = { rolling: "5h", weekly: "wk", monthly: "mo" };
		const PROVIDER_LABEL = { ocgo: "OpenCode Go", deepseek: "DeepSeek", zhipu: "GLM Plan" };

		/** The usage chip for the session's current provider. */
		function UsageDockEntry(props) {
			const [usageProvider, setUsageProvider] = useState(undefined);
			const [view, setView] = useState(null);
			const [open, setOpen] = useState(false);
			const [mode, setMode] = useState("view");
			const [config, setConfig] = useState(null);
			const [drafts, setDrafts] = useState({});
			const wrapRef = useRef(null);
			const modeRef = useRef("view");
			modeRef.current = mode;
			const draftsRef = useRef(drafts);
			draftsRef.current = drafts;
			const configRef = useRef(config);
			configRef.current = config;
			const providerRef = useRef(undefined);
			providerRef.current = usageProvider;

			/** Resolve the session provider and (re)load its view when mapped. */
			const syncProvider = useCallback((fetchView) => {
				let live = true;
				const resolve = props.provider !== undefined
					? Promise.resolve().then(() => props.provider()).catch(() => undefined)
					: Promise.resolve(undefined);
				resolve.then((sessionProvider) => {
					if (!live) return;
					const mapped = providerToUsage(sessionProvider);
					if (mapped !== providerRef.current) {
						setUsageProvider(mapped);
						setView(null);
						setOpen(false);
						setMode("view");
					}
					if (mapped !== undefined && fetchView) {
						musageApi.view(mapped).then((snapshot) => { if (live) setView(snapshot); }, () => { if (live) setView(null); });
					}
				});
				return () => { live = false; };
			}, [props.provider]);

			// Mount: resolve provider once + first (cached) view. No timer.
			useEffect(() => syncProvider(true), [syncProvider]);

			// Turn lifecycle: turn/start re-resolves the provider (model may
			// have switched); turn/end loads the fresh usage for the round.
			useEffect(() => {
				if (props.dockSessionId === undefined) return;
				return subscribeTurns(props.dockSessionId, (eventType) => {
					if (eventType === "turn/start") syncProvider(false);
					else syncProvider(true);
				});
			}, [props.dockSessionId, syncProvider]);

			// Model switch: the shared model directory pushes selection changes
			// the moment the user picks a different provider in the composer.
			useEffect(() => {
				if (props.dockSessionId === undefined || typeof props.providerEvents !== "function") return;
				const stop = props.providerEvents(() => { syncProvider(true); });
				return () => { if (typeof stop === "function") stop(); };
			}, [props.dockSessionId, props.providerEvents, syncProvider]);

			const refresh = useCallback(() => {
				const provider = providerRef.current;
				if (provider === undefined) return;
				musageApi.refresh(provider).then((snapshot) => setView(snapshot), () => {});
			}, []);

			const loadConfig = useCallback(() => {
				musageApi.config().then((snapshot) => {
					const section = snapshot?.config?.[providerRef.current ?? ""];
					setConfig(section ?? {});
					const next = {};
					for (const field of Object.keys(section ?? {})) next[field] = maskedText(section[field]);
					setDrafts(next);
				}, () => {
					setConfig(null);
					setDrafts({});
				});
			}, []);

			const saveConfig = useCallback(() => {
				const provider = providerRef.current;
				if (provider === undefined) return;
				const current = configRef.current;
				const section = {};
				const fields = Object.keys(draftsRef.current);
				for (const field of fields) {
					const value = String(draftsRef.current[field] ?? "").trim();
					if (value.length === 0) continue;
					const baseline = current !== null ? maskedText(current[field]) : "";
					if (value === baseline) continue;
					section[field] = value;
				}
				if (Object.keys(section).length === 0) return;
				musageApi.writeConfig({ [provider]: section }).then((snapshot) => {
					const updated = snapshot?.config?.[provider];
					setConfig(updated ?? {});
					const next = {};
					for (const field of Object.keys(updated ?? {})) next[field] = maskedText(updated[field]);
					setDrafts(next);
					refresh();
				}, () => {});
			}, [refresh]);

			const closePanel = useCallback(() => {
				if (modeRef.current === "set") saveConfig();
				setOpen(false);
				setMode("view");
			}, [saveConfig]);

			const openSet = useCallback(() => {
				setMode("set");
				setOpen(true);
				loadConfig();
			}, [loadConfig]);

			useEffect(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (target !== null && wrapRef.current !== null && !wrapRef.current.contains(target)) closePanel();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") closePanel();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, closePanel]);

			if (usageProvider === undefined) return null;

			const t = props.t;
			const sep = t !== undefined ? t("musage.sep") : "·";
			const windows = view?.ok && Array.isArray(view.data?.windows) ? view.data.windows : [];
			const balance = view?.ok ? view.data?.balance : undefined;
			const notes = view?.ok && Array.isArray(view.data?.notes) ? view.data.notes : [];
			const error = view !== null && view.ok === false ? view.error : undefined;

			const segments = [];
			if (balance !== undefined) {
				const low = balance.currency === "CNY" && balance.amount < LOW_BALANCE_CNY;
				segments.push(React.createElement("span", {
					key: "balance",
					className: low ? "mus_segWarn" : undefined
				}, formatMoney(balance.amount, balance.currency)));
			}
			for (const window of windows) {
				const err = window.status === "rate-limited" || window.percent >= 90;
				const warn = !err && window.percent >= 80;
				segments.push(React.createElement("span", { key: window.key, className: "mus_seg" },
					React.createElement("span", { className: "mus_segSep" }, sep),
					React.createElement("span", { className: err ? "mus_segErr" : warn ? "mus_segWarn" : undefined },
						SHORT_WINDOW[window.key] ?? window.label,
						" ",
						String(window.percent),
						"% (",
						formatDuration(window.resetInSec),
						")"
					)
				));
			}

			return React.createElement("span", { className: "mus_wrap", ref: wrapRef },
				React.createElement("span", {
					className: open ? "mus_chip mus_chipOpen" : "mus_chip",
					onClick: () => { if (error !== undefined) openSet(); else setOpen(!open); },
					title: error !== undefined ? (error.message + "\n" + (t !== undefined ? t("musage.set") : "Set")) : (t !== undefined ? t("musage.expand") : "")
				},
					React.createElement("span", null, PROVIDER_LABEL[usageProvider] + ":"),
					error !== undefined
						? React.createElement("span", { className: "mus_segErr" }, "<err:" + error.code + ">")
						: segments.length > 0 ? segments : React.createElement("span", null, "…"),
					view?.updatedAt !== undefined
						? React.createElement("span", { className: "mus_segSep" }, sep, " upd ", formatClock(view.updatedAt))
						: null
				),
				open ? React.createElement("span", { className: "mus_details" },
					mode === "set" ? renderSetPanel(usageProvider, config, drafts, setDrafts, t, saveConfig) : React.createElement(React.Fragment, null,
						balance !== undefined
							? React.createElement("span", { className: "mus_window" },
								React.createElement("span", { className: "mus_windowLabel" }, t !== undefined ? t("musage.balance") : "Balance"),
								React.createElement("span", { className: "mus_windowValue" }, formatMoney(balance.amount, balance.currency))
							)
							: null,
						windows.map((window) => React.createElement("span", { className: "mus_window", key: window.key },
							React.createElement("span", { className: "mus_windowLabel" }, windowLabel(window, t)),
							React.createElement("span", { className: "mus_windowValue" },
								String(window.percent) + "%",
								window.resetInSec > 0
									? React.createElement("span", { className: "mus_windowReset" },
										(t !== undefined ? t("musage.resetsIn") : "resets in ") + formatDuration(window.resetInSec))
									: null
							)
						)),
						notes.map((note, index) => React.createElement("span", { className: "mus_note", key: index }, note)),
						React.createElement("span", { className: "mus_foot" },
							React.createElement("span", { className: "mus_setBtn", onClick: openSet }, t !== undefined ? t("musage.set") : "Set"),
							React.createElement("span", { className: "mus_footRight" },
								view?.updatedAt !== undefined
									? React.createElement("span", { className: "mus_fetchedAt" }, "upd " + formatClock(view.updatedAt))
									: null,
								React.createElement("span", { className: "mus_refreshBtn", onClick: refresh }, t !== undefined ? t("musage.refresh") : "Refresh")
							)
						)
					)
				) : null
			);
		}

		const WINDOW_TITLE = { rolling: "musage.rolling", weekly: "musage.weekly", monthly: "musage.monthly", tokens5h: "musage.tokens5h" };
		const windowLabel = (window, t) => {
			const key = WINDOW_TITLE[window.key];
			if (key !== undefined && t !== undefined) return t(key);
			return window.label ?? window.key;
		};

		function renderSetPanel(provider, config, drafts, setDrafts, t, saveConfig) {
			const fields = provider === "ocgo"
				? [{ field: "workspaceID", label: "workspace id", placeholder: "wrk_…" },
					{ field: "cookie", label: "cookie", placeholder: "Fe26.2… or auth=Fe26.2…" }]
				: [{ field: "apiKey", label: "API key", placeholder: "sk-…" }];
			return React.createElement("span", { className: "mus_setPanel" },
				fields.map(({ field, label, placeholder }) => React.createElement("label", { className: "mus_field", key: field },
					React.createElement("span", { className: "mus_fieldLabel" }, label),
					React.createElement("input", {
						className: "mus_fieldInput",
						value: drafts[field] ?? "",
						placeholder: placeholder,
						spellCheck: false,
						autoComplete: "off",
						onChange: (event) => setDrafts((prev) => ({ ...prev, [field]: event.target.value })),
						onFocus: (event) => {
							const current = config !== null ? config[field] : undefined;
							const masked = maskedText(current);
							if (masked.length > 0 && event.target.value === masked) event.target.select();
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") { event.preventDefault(); saveConfig(); }
						}
					})
				)),
				React.createElement("span", { className: "mus_setHint" }, t !== undefined ? t("musage.setHint") : "click outside or press Esc to save")
			);
		}

		// ── locales ────────────────────────────────────────────────────────────

		const zh = {
			"musage.sep": "·",
			"musage.set": "设置",
			"musage.refresh": "刷新",
			"musage.expand": "展开用量详情",
			"musage.balance": "余额",
			"musage.rolling": "5 小时滚动",
			"musage.weekly": "每周",
			"musage.monthly": "每月",
			"musage.tokens5h": "5 小时 tokens",
			"musage.resetsIn": "剩余 {duration}",
			"musage.setHint": "点击外部或按 Esc 保存",
			"musage.noconfigOcgo": "未配置：设置 OPENCODE_GO_COOKIE 与 OPENCODE_GO_WORKSPACE_ID（或 ~/.dsh/usage-suite.json / ~/.dsh/ocgo-usage.json）",
			"musage.noconfigDeepseek": "未配置：设置 DEEPSEEK_API_KEY（或 ~/.dsh/usage-suite.json）",
			"musage.noconfigZhipu": "未配置：设置 ZAI_CODING_CN_API_KEY（或 ~/.dsh/usage-suite.json）"
		};
		const en = {
			"musage.sep": "·",
			"musage.set": "Set",
			"musage.refresh": "Refresh",
			"musage.expand": "Show usage details",
			"musage.balance": "Balance",
			"musage.rolling": "5h Rolling",
			"musage.weekly": "Weekly",
			"musage.monthly": "Monthly",
			"musage.tokens5h": "5h tokens",
			"musage.resetsIn": "resets in {duration}",
			"musage.setHint": "click outside or press Esc to save",
			"musage.noconfigOcgo": "Not configured: set OPENCODE_GO_COOKIE and OPENCODE_GO_WORKSPACE_ID (or ~/.dsh/usage-suite.json / ~/.dsh/ocgo-usage.json)",
			"musage.noconfigDeepseek": "Not configured: set DEEPSEEK_API_KEY (or ~/.dsh/usage-suite.json)",
			"musage.noconfigZhipu": "Not configured: set ZAI_CODING_CN_API_KEY (or ~/.dsh/usage-suite.json)"
		};

		// ── plugin registration ────────────────────────────────────────────────

		const NS = "musage";
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-usage-suite: dictionaries");
			// Optional dependency: the composer model seat's shared ModelDirectory
			// store pushes provider switches the instant the user picks one. When
			// the service is absent this branch stays dormant (turn-driven refresh
			// still covers the chip).
			ctx.inject(["modelDirectories"], (scope) => {
				modelDirectoriesHandle = scope.get("modelDirectories");
			});
			ctx.inject(["slots", "conversation", "connection"], (scope) => {
				connectionHandle = scope.get("connection");
				scope.effect(() => scope.slots.register({
					name: "conversation.composer.dock",
					id: "usage-suite",
					order: 111,
					locale: NS,
					inject: (sessionId) => ({
						dockSessionId: sessionId,
						provider: async () => {
							const sessions = connectionHandle?.api?.sessions;
							if (sessions === undefined) return undefined;
							try {
								const { result } = await sessions.models({ sessionId });
								if (!result.ok) return undefined;
								return result.value?.current?.provider;
							} catch {
								return undefined;
							}
						},
						providerEvents: (callback) => subscribeProviderSwitches(sessionId, callback)
					})
				}, UsageDockEntry), "dsh-usage-suite: chip registration");
			});
		}

		exports.UsageDockEntry = UsageDockEntry;
		exports.apply = apply;
		exports.inject = inject;
		exports.providerToUsage = providerToUsage;
		return module.exports;
	}
});
