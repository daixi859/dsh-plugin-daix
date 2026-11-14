/**
 * dsh-css-override — browser half.
 *
 * Two responsibilities:
 *
 *  1. The injection engine. Every ENABLED rule is concatenated in order into
 *     ONE <style> element appended to document.body (after the shell's own
 *     head stylesheets, so a rule with equal specificity wins). Re-applied on
 *     every edit, so the page reflects what the editor shows immediately.
 *
 *  2. The settings page (Plugins section -> "CSS 覆盖" tab): create / rename /
 *     enable / edit / duplicate / delete rules, each rule being one block of
 *     CSS text. Everything is persisted through the host half into
 *     $DSH_HOME/css-override/rules.json, with a localStorage shadow that keeps
 *     the rules alive when the host is unreachable.
 *
 * Authored by hand in the DSH client module format: a plain script that
 * registers one lazy factory into window.__ModuleLoader__.
 */
window.__ModuleLoader__.load({
	id: "dsh-css-override",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const PLUGIN_ID = "dsh-css-override";
		const STYLE_TAG_ID = PLUGIN_ID + "/rules";
		const SHEET_TAG_ID = PLUGIN_ID + "/ui.css";
		const LS_KEY = "dsh.cssOverride.v1";
		const API_LOAD = "/api/dsh-css-override/load";
		const API_SAVE = "/api/dsh-css-override/save";
		const API_REVEAL = "/api/dsh-css-override/reveal";

		const MAX_RULES = 200;
		const MAX_CSS_BYTES = 200 * 1024;

		/* ================================================================== *
		 * i18n — the client locale service when it is composed, plus a plain
		 * dictionary fallback so the page is never blank in a bare client.
		 * ================================================================== */
		const DICT = {
			zh: {
				title: "CSS 覆盖", tab: "CSS 覆盖",
				blurb: "每条规则是一段 CSS。勾选启用的规则会按顺序拼成一份样式表，注入到页面 <body> 尾部，覆盖应用默认样式。",
				newRule: "新建规则", newRuleName: "新规则", exportCss: "导出 CSS", reveal: "打开文件", copyPath: "复制路径",
				search: "搜索规则名或 CSS 片段…", empty: "还没有规则。点「新建规则」写第一条 CSS 覆盖。",
				noMatch: "没有匹配的规则。", statTotal: "条规则", statOn: "条启用", statChars: "字符生效",
				on: "已启用", off: "已停用", edit: "编辑", duplicate: "复制", del: "删除", apply: "应用", discard: "撤销改动",
				unsaved: "未应用", applied: "已应用", saving: "保存中…", saved: "已落盘", saveFailed: "保存失败", offline: "离线（仅本地缓存）",
				conflict: "规则文件已被其他窗口修改，已重新载入",
				rename: "重命名", enabledTip: "启用后本条 CSS 会注入页面", files: "条规则", chars: "字符",
				namePlaceholder: "规则名", cssPlaceholder: "/* 选择器 { 属性: 值 } */\n.dshApp_sidebar {\n  background: #101828;\n}",
				snippet: "插入常用片段", emptyCss: "这段 CSS 还是空的，填点内容才会生效。",
				delConfirm: "删除规则", delConfirmBody: "删除后可以用「撤销改动」找回吗？不能，删除会立即落盘。",
				delYes: "删除", cancel: "取消",
				exported: "已导出合并后的 CSS", copied: "路径已复制到剪贴板", copyFailed: "复制失败，请手动选择",
				reload: "从磁盘重新载入", reloaded: "已从磁盘重新载入",
				pathLabel: "落盘位置", charCount: "字符", lineCount: "行",
				howtoTitle: "怎么写才生效", howtoBody: "选择器要命中应用里真实的类名（按 F12 取元素 → 复制 selector）。同优先级下后写的规则胜出，用 !important 可以强制覆盖内联样式以外的声明。",
				starters: [
					["圆角卡片", ".dshApp_card, [class*=\"Card\"] {\n  border-radius: 14px;\n}"],
					["更紧凑的间距", ".dshApp_chat { --dsh-content-gap: 6px; }"],
					["等宽字体", "code, pre, kbd { font-family: var(--ds-font-family-code, ui-monospace); }"],
					["下划线链接", "a { text-underline-offset: 2px; text-decoration-thickness: 1px; }"],
				],
			},
			en: {
				title: "CSS Override", tab: "CSS Override",
				blurb: "Each rule is one block of CSS. Enabled rules are concatenated in order into a single stylesheet injected at the end of <body>, overriding the app's own styles.",
				newRule: "New rule", newRuleName: "New rule", exportCss: "Export CSS", reveal: "Open file", copyPath: "Copy path",
				search: "Search name or CSS…", empty: "No rules yet. Hit “New rule” to write your first override.",
				noMatch: "No matching rule.", statTotal: "rules", statOn: "enabled", statChars: "chars live",
				on: "Enabled", off: "Disabled", edit: "Edit", duplicate: "Duplicate", del: "Delete", apply: "Apply", discard: "Discard",
				unsaved: "unapplied", applied: "applied", saving: "Saving…", saved: "On disk", saveFailed: "Save failed", offline: "Offline (local cache)",
				conflict: "The rules file changed elsewhere — reloaded",
				rename: "Rename", enabledTip: "When enabled, this CSS is injected into the page", files: "rules", chars: "chars",
				namePlaceholder: "Rule name", cssPlaceholder: "/* selector { property: value } */\n.dshApp_sidebar {\n  background: #101828;\n}",
				snippet: "Insert a starter", emptyCss: "This rule is still empty — it applies nothing yet.",
				delConfirm: "Delete rule", delConfirmBody: "Deletion cannot be undone by “Discard” — it is written to disk immediately.",
				delYes: "Delete", cancel: "Cancel",
				exported: "Merged CSS exported", copied: "Path copied to clipboard", copyFailed: "Copy failed — select it manually",
				reload: "Reload from disk", reloaded: "Reloaded from disk",
				pathLabel: "Stored at", charCount: "chars", lineCount: "lines",
				howtoTitle: "How to make it stick", howtoBody: "The selector must hit a real class in the app (F12 → pick element → Copy selector). With equal specificity the later rule wins; use !important against anything but inline styles.",
				starters: [
					["Rounder cards", ".dshApp_card, [class*=\"Card\"] {\n  border-radius: 14px;\n}"],
					["Tighter rhythm", ".dshApp_chat { --dsh-content-gap: 6px; }"],
					["Monospace", "code, pre, kbd { font-family: var(--ds-font-family-code, ui-monospace); }"],
					["Underlined links", "a { text-underline-offset: 2px; text-decoration-thickness: 1px; }"],
				],
			},
		};
		let boundT = null;
		/** Translate through the client locale service when bound; else the built-in dictionary. */
		function t(key) {
			if (boundT !== null) {
				try {
					const value = boundT(key);
					if (typeof value === "string" && value !== "" && value !== key) return value;
				} catch { /* fall through to the local dictionary */ }
			}
			const lang = (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.toLowerCase().indexOf("zh") === 0) ? "zh" : "en";
			const dict = DICT[lang] || DICT.en;
			const value = dict[key];
			return value === undefined ? key : value;
		}

		/* ================================================================== *
		 * Rule model
		 * ================================================================== */
		let idSeed = 0;
		function newId() {
			idSeed += 1;
			return "r" + Date.now().toString(36) + "-" + idSeed.toString(36) + Math.random().toString(36).slice(2, 6);
		}
		function nowIso() {
			try { return new Date().toISOString(); } catch { return ""; }
		}
		function byteLength(text) {
			/* TextEncoder counts UTF-8 bytes without pulling in Buffer. */
			try { return new TextEncoder().encode(text).length; } catch { return text.length; }
		}
		function makeRule(name, css) {
			return { id: newId(), name: name, css: css || "", enabled: true, updatedAt: nowIso() };
		}
		/** Repair one entry from disk / localStorage / the wire. */
		function normalizeRule(raw, index) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
			const css = typeof raw.css === "string" ? raw.css : "";
			if (byteLength(css) > MAX_CSS_BYTES) return null;
			const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim().slice(0, 80) : t("newRuleName") + " " + (index + 1);
			/* Carry through any field a document already had (an older version
			   wrote `label`/`hint`; the UI no longer edits them) so opening and
			   saving an old file never silently drops what was in it. */
			return Object.assign({}, raw, {
				id: typeof raw.id === "string" && raw.id !== "" ? raw.id.slice(0, 64) : newId(),
				name: name,
				css: css,
				enabled: raw.enabled !== false,
				updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt !== "" ? raw.updatedAt.slice(0, 40) : nowIso(),
			});
		}
		function normalizeRules(input) {
			const list = Array.isArray(input) ? input : [];
			const out = [];
			const seen = new Set();
			for (let i = 0; i < list.length && out.length < MAX_RULES; i++) {
				const rule = normalizeRule(list[i], out.length);
				if (rule === null) continue;
				if (seen.has(rule.id)) rule.id = newId();
				seen.add(rule.id);
				out.push(rule);
			}
			return out;
		}

		/* ================================================================== *
		 * Injection engine
		 * ================================================================== */
		/** The one stylesheet this plugin owns; created lazily inside <body>. */
		let ruleTag = null;
		/** Rules currently injected (mirrors the store). */
		let liveRules = [];

		/** Merge enabled rules into one stylesheet body. */
		function buildCss(rules) {
			const parts = [];
			rules.forEach((rule, index) => {
				if (rule.enabled !== true) return;
				const body = rule.css.trim();
				if (body === "") return;
				parts.push("/* dsh-css-override: " + rule.name.replace(/\*\//g, "*\\/") + " */\n" + body);
			});
			return parts.join("\n\n");
		}

		/** Create (or re-find) the injected <style> element inside document.body. */
		function ensureTag() {
			if (typeof document === "undefined") return null;
			if (ruleTag !== null && ruleTag.isConnected === true) return ruleTag;
			/* A previous page load of this bundle may have left one behind. */
			const existing = document.body === null ? null : document.body.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]');
			if (existing !== null && existing !== undefined) {
				ruleTag = existing;
				return ruleTag;
			}
			if (document.body === null) return null;
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = STYLE_TAG_ID;
			/* Last child of <body>: after every shell stylesheet, and after any
			   plugin sheet that appended earlier. */
			document.body.appendChild(tag);
			ruleTag = tag;
			return ruleTag;
		}

		function applyRules() {
			const tag = ensureTag();
			if (tag === null) return 0;
			const css = buildCss(liveRules);
			if (tag.textContent !== css) tag.textContent = css;
			return countEnabled();
		}
		function countEnabled() {
			let n = 0;
			for (const rule of liveRules) if (rule.enabled === true && rule.css.trim() !== "") n += 1;
			return n;
		}

		/* ================================================================== *
		 * Persistence — host file first, localStorage as the offline shadow.
		 * One promise chain orders every round-trip; `writeEpoch` marks local
		 * mutations so a slow load can never overwrite a fresh local edit.
		 * ================================================================== */
		let state = { rules: [], revision: 0, path: "", status: "idle", error: "", hostOk: false, openId: null };
		let writeEpoch = 0;
		let queue = Promise.resolve();
		const listeners = new Set();
		/** Unsaved drafts, keyed by rule id — see the editor component. */
		const drafts = new Map();

		function enqueue(task) {
			const run = queue.then(task);
			queue = run.then(() => undefined, () => undefined);
			return run;
		}
		function emit() {
			for (const listener of Array.from(listeners)) listener();
		}
		function snapshot() {
			return state;
		}
		function subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}
		/** React 18 external store binding. */
		function useStore() {
			return React.useSyncExternalStore(subscribe, snapshot, snapshot);
		}
		function setState(patch) {
			state = Object.assign({}, state, patch);
			emit();
		}
		/**
		 * Which rule is expanded in the settings page. UI-only state that lives
		 * in the store rather than in component state: the page re-renders from
		 * store notifications (host reloads, cross-tab sync, saves), and an
		 * expanded editor must survive those — component-local state would be
		 * reset by them. Never persisted.
		 */
		function setOpenId(id) {
			const next = typeof id === "function" ? id(state.openId === undefined ? null : state.openId) : id;
			setState({ openId: next });
		}
		/** Mirror the current rules into localStorage so an offline reload still has them. */
		function shadowWrite(rules) {
			try {
				localStorage.setItem(LS_KEY, JSON.stringify({ rules: rules, savedAt: nowIso() }));
			} catch { /* quota or disabled storage — the host copy is canonical */ }
		}
		function shadowRead() {
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				const rules = normalizeRules(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.rules : parsed);
				return rules.length > 0 ? rules : null;
			} catch { return null; }
		}

		/** Push the whole rule list to the host file. */
		async function pushToHost(rules, revision) {
			const response = await fetch(API_SAVE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ rules: rules, revision: revision }),
			});
			if (response.status === 409) {
				const conflict = { conflict: true, revision: 0 };
				try {
					const body = await response.json();
					if (typeof body.revision === "number") conflict.revision = body.revision;
				} catch { /* keep the default */ }
				return conflict;
			}
			if (!response.ok) throw new Error("http " + response.status);
			const body = await response.json();
			return { revision: typeof body.revision === "number" ? body.revision : revision + 1, path: body.path };
		}

		/** Load rules: host document wins; a host without a file adopts the shadow. */
		function loadFromHost() {
			return enqueue(async () => {
				const epochAtStart = writeEpoch;
				const stale = () => writeEpoch !== epochAtStart;
				setState({ status: "loading", error: "" });
				let body = null;
				try {
					const response = await fetch(API_LOAD, { headers: { accept: "application/json" } });
					if (!response.ok) throw new Error("http " + response.status);
					body = await response.json();
				} catch (error) {
					/* Host unreachable: run on the local shadow, keep editing. */
					const local = shadowRead();
					if (stale()) return state;
					if (local !== null) {
						liveRules = local;
						applyRules();
					}
					setState({ status: "offline", hostOk: false, error: String(error && error.message ? error.message : error) });
					return state;
				}
				if (stale()) return state;
				const hostRules = normalizeRules(body.rules);
				const path = typeof body.path === "string" ? body.path : "";
				if (hostRules.length > 0) {
					liveRules = hostRules;
					shadowWrite(hostRules);
					setState({ rules: hostRules, revision: typeof body.revision === "number" ? body.revision : 0, path: path, status: "ready", hostOk: true, error: "" });
					applyRules();
					return state;
				}
				/* Host has no rules yet: migrate the shadow up once, then the
				   host document is canonical from here on. */
				const local = shadowRead();
				if (local !== null) {
					liveRules = local;
					setState({ rules: local, revision: typeof body.revision === "number" ? body.revision : 0, path: path, status: "ready", hostOk: true, error: "" });
					applyRules();
					writeEpoch += 1;
					try {
						const result = await pushToHost(local, typeof body.revision === "number" ? body.revision : 0);
						if (result.conflict !== true) setState({ revision: result.revision });
					} catch { /* stays local; the next edit retries */ }
					return state;
				}
				liveRules = [];
				setState({ rules: [], revision: typeof body.revision === "number" ? body.revision : 0, path: path, status: "ready", hostOk: true, error: "" });
				applyRules();
				return state;
			});
		}

		/**
		 * Compute the next rule list from a mutation and persist it.
		 * @param {(rules: object[]) => object[]} mutate - pure list transform.
		 */
		function commit(mutate) {
			return enqueue(async () => {
				const base = normalizeRules(state.rules);
				const next = normalizeRules(mutate(base));
				writeEpoch += 1;
				liveRules = next;
				setState({ rules: next, status: "saving", error: "" });
				applyRules();
				shadowWrite(next);
				try {
					const result = await pushToHost(next, state.revision);
					if (result.conflict === true) {
						setState({ revision: result.revision, status: "ready", error: t("conflict") });
						queue = queue.then(() => loadFromHost());
						return state;
					}
					setState({ revision: result.revision, status: "ready", path: result.path || state.path, hostOk: true, error: "" });
				} catch (error) {
					setState({ status: "offline", hostOk: false, error: String(error && error.message ? error.message : error) });
				}
				return state;
			});
		}

		/* ================================================================== *
		 * Page chrome styles (theme tokens only, so light/dark both work)
		 * ================================================================== */
		const UI = {
			text: "var(--dsw-alias-label-primary, #172a45)",
			text2: "var(--dsw-alias-label-secondary, #5d6b7e)",
			text3: "var(--dsw-alias-label-tertiary, color-mix(in srgb, var(--dsw-alias-label-secondary, #5d6b7e) 72%, transparent))",
			border: "var(--dsw-alias-border-l1, rgba(120,130,150,.25))",
			border2: "var(--dsw-alias-border-l2, rgba(120,130,150,.4))",
			layer1: "var(--dsw-alias-bg-layer-1, rgba(125,135,155,.06))",
			layer2: "var(--dsw-alias-bg-layer-2, rgba(125,135,155,.12))",
			overlay: "var(--dsw-alias-bg-overlay, #fff)",
			accent: "var(--dsw-alias-brand-primary, #2b6cb0)",
			ok: "var(--dsw-alias-state-success-primary, #1a7f37)",
			warn: "var(--dsw-alias-state-warn-primary, #b26a00)",
			err: "var(--dsw-alias-state-error-primary, #d93025)",
			idle: "var(--dsw-alias-state-idle-primary, rgba(120,130,150,.7))",
			radius: 12,
			mono: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
		};

		function sheetCss() {
			const s = [];
			/* `[class^="dco_"]` / `[class*=" dco_"]` outranks the app's own bare
			   element selectors (button, input, textarea), so the host's base
			   styles cannot inflate our controls; box-sizing and line-height are
			   pinned on every control for the same reason. */
			s.push("[class^=\"dco_\"],[class*=\" dco_\"]{box-sizing:border-box}");
			s.push(".dco_root{display:flex;flex-direction:column;gap:12px;max-width:760px;color:" + UI.text + ";font-size:13px}");
			s.push(".dco_card{background:" + UI.layer1 + ";border:1px solid " + UI.border + ";border-radius:" + UI.radius + "px}");
			s.push(".dco_head{padding:14px 16px;display:flex;flex-direction:column;gap:6px}");
			s.push(".dco_h1{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;letter-spacing:.01em}");
			s.push(".dco_glyph{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:color-mix(in srgb," + UI.accent + " 16%,transparent);color:" + UI.accent + ";font-size:12px}");
			s.push(".dco_sub{color:" + UI.text2 + ";line-height:1.65;font-size:12.5px}");
			s.push(".dco_bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid " + UI.border + "}");
			s.push(".dco_grow{flex:1 1 auto;min-width:0}");
			s.push(".dco_btn{cursor:pointer;border-radius:9px;font-size:12.5px;font-weight:500;height:30px;padding:0 11px;line-height:1;white-space:nowrap;border:1px solid " + UI.border + ";background:" + UI.layer2 + ";color:" + UI.text + ";transition:filter .12s,background .12s,border-color .12s}");
			s.push(".dco_btn:hover{filter:brightness(1.06);border-color:" + UI.border2 + "}");
			s.push(".dco_btn:disabled{opacity:.5;cursor:not-allowed}");
			s.push(".dco_btn--primary{background:" + UI.accent + ";color:#fff;border-color:transparent}");
			s.push(".dco_btn--ghost{background:transparent;border-color:transparent;color:" + UI.text2 + "}");
			s.push(".dco_btn--ghost:hover{background:" + UI.layer2 + ";color:" + UI.text + "}");
			s.push(".dco_btn--danger{background:transparent;border-color:color-mix(in srgb," + UI.err + " 55%,transparent);color:" + UI.err + "}");
			s.push(".dco_btn--icon{height:26px;padding:0 8px;font-size:13px}");
			s.push(".dco_chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid " + UI.border + ";background:" + UI.layer2 + ";color:" + UI.text2 + ";font-size:11.5px;font-variant-numeric:tabular-nums}");
			s.push(".dco_dot{width:6px;height:6px;border-radius:50%;background:" + UI.idle + "}");
			s.push(".dco_dot--on{background:" + UI.ok + "}");
			s.push(".dco_dot--busy{background:" + UI.warn + "}");
			s.push(".dco_dot--err{background:" + UI.err + "}");
			s.push(".dco_list{display:flex;flex-direction:column}");
			s.push(".dco_item{display:flex;flex-direction:column;border-top:1px solid " + UI.border + "}");
			s.push(".dco_item:first-child{border-top:none}");
			s.push(".dco_row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:10px;padding:11px 16px}");
			s.push(".dco_item:hover{background:color-mix(in srgb," + UI.layer2 + " 60%,transparent)}");
			s.push(".dco_item--open{background:color-mix(in srgb," + UI.layer2 + " 45%,transparent)}");
			s.push(".dco_item--open .dco_row{background:transparent}");
			s.push(".dco_main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:5px}");
			s.push(".dco_line{display:flex;align-items:center;gap:8px;min-width:0}");
			s.push(".dco_name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid transparent;border-radius:7px;padding:2px 5px;margin:-2px -5px;cursor:text}");
			s.push(".dco_name:hover{border-color:" + UI.border + "}");
			s.push(".dco_nameInput{font-weight:600;font-size:13px;font-family:inherit;height:26px;padding:0 6px;border-radius:7px;border:1px solid " + UI.accent + ";background:" + UI.overlay + ";color:" + UI.text + ";outline:none;min-width:120px}");
			s.push(".dco_meta{color:" + UI.text3 + ";font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}");
			s.push(".dco_preview{font-family:" + UI.mono + ";font-size:11.5px;color:" + UI.text2 + ";background:" + UI.layer2 + ";border:1px solid " + UI.border + ";border-radius:8px;padding:6px 8px;max-height:52px;overflow:hidden;white-space:pre;text-overflow:ellipsis;line-height:1.5;margin:0}");
			s.push(".dco_preview--empty{color:" + UI.text3 + ";font-family:inherit;font-style:italic}");
			s.push(".dco_badge{font-size:10.5px;line-height:1.5;padding:2px 7px;border-radius:999px;border:1px solid " + UI.border + ";color:" + UI.text3 + "}");
			s.push(".dco_badge--on{color:" + UI.ok + ";border-color:color-mix(in srgb," + UI.ok + " 45%,transparent);background:color-mix(in srgb," + UI.ok + " 10%,transparent)}");
			s.push(".dco_badge--dirty{color:" + UI.warn + ";border-color:color-mix(in srgb," + UI.warn + " 45%,transparent);background:color-mix(in srgb," + UI.warn + " 10%,transparent)}");
			s.push(".dco_sw{position:relative;flex:0 0 auto;width:36px;height:20px;padding:0;border-radius:999px;border:1px solid " + UI.border2 + ";background:" + UI.layer2 + ";cursor:pointer;transition:background .16s,border-color .16s;margin-top:2px}");
			s.push(".dco_sw::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:" + UI.overlay + ";box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .16s}");
			s.push(".dco_sw--on{background:" + UI.accent + ";border-color:transparent}");
			s.push(".dco_sw--on::after{transform:translateX(16px);background:#fff}");
			s.push(".dco_acts{display:flex;align-items:center;gap:4px;flex:0 0 auto}");
			s.push(".dco_editor{border-top:1px dashed " + UI.border + ";padding:12px 16px 2px;display:flex;flex-direction:column;gap:10px;min-width:0}");
			s.push(".dco_codeWrap{display:flex;width:100%;border:1px solid " + UI.border + ";border-radius:10px;overflow:hidden;background:" + UI.layer2 + "}");
			s.push(".dco_gutter{flex:0 0 auto;margin:0;padding:9px 8px 9px 10px;text-align:right;color:" + UI.text3 + ";font-family:" + UI.mono + ";font-size:12.5px;line-height:1.6;user-select:none;border-right:1px solid " + UI.border + ";background:color-mix(in srgb," + UI.layer1 + " 70%,transparent);min-width:34px}");
			s.push(".dco_codeArea{position:relative;flex:1 1 auto;min-width:0}");
			s.push(".dco_code,.dco_hl{margin:0;padding:9px 12px;border:none;font-family:" + UI.mono + ";font-size:12.5px;font-weight:400;line-height:1.6;tab-size:2;white-space:pre;overflow:auto;height:150px;min-height:150px;max-height:46vh}");
			s.push(".dco_hl{position:absolute;inset:0;pointer-events:none;color:" + UI.text + ";background:transparent}");
			s.push(".dco_code{position:relative;display:block;width:100%;background:transparent;color:transparent;caret-color:" + UI.text + ";resize:vertical;outline:none}");
			s.push(".dco_code::selection{background:color-mix(in srgb," + UI.accent + " 32%,transparent)}");
			s.push(".dco_tok-c{color:" + UI.text3 + ";font-style:italic}");
			s.push(".dco_tok-s{color:" + UI.ok + "}");
			s.push(".dco_tok-p{color:" + UI.accent + "}");
			s.push(".dco_tok-v{color:" + UI.text + "}");
			s.push(".dco_tok-a{color:" + UI.warn + ";font-weight:600}");
			s.push(".dco_tok-sel{color:#c2410c;font-weight:600}");
			s.push(".dco_editFoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}");
			s.push(".dco_note{color:" + UI.text2 + ";font-size:12px;line-height:1.6;background:color-mix(in srgb," + UI.accent + " 7%,transparent);border:1px solid color-mix(in srgb," + UI.accent + " 20%,transparent);border-radius:10px;padding:9px 11px}");
			s.push(".dco_note b{color:" + UI.text + "}");
			s.push(".dco_pathRow{display:flex;align-items:center;gap:8px;padding:9px 16px;border-top:1px solid " + UI.border + ";color:" + UI.text3 + ";font-size:11.5px;flex-wrap:wrap}");
			s.push(".dco_path{font-family:" + UI.mono + ";font-size:11.5px;color:" + UI.text2 + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}");
			s.push(".dco_empty{padding:26px 16px;text-align:center;color:" + UI.text2 + ";display:flex;flex-direction:column;gap:10px;align-items:center}");
			s.push(".dco_emptyGlyph{font-size:22px;opacity:.75}");
			s.push(".dco_toast{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;pointer-events:none}");
			s.push(".dco_toastItem{pointer-events:auto;background:" + UI.overlay + ";color:" + UI.text + ";border:1px solid " + UI.border + ";border-radius:10px;padding:9px 12px;font-size:12.5px;box-shadow:0 10px 28px rgba(0,0,0,.18);animation:dco_in .18s ease-out}");
			s.push("@keyframes dco_in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}");
			s.push(".dco_modal{position:fixed;inset:0;z-index:2147483100;background:rgba(15,20,30,.42);display:flex;align-items:center;justify-content:center;padding:20px}");
			s.push(".dco_modalCard{width:min(420px,100%);background:" + UI.overlay + ";border:1px solid " + UI.border + ";border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 24px 60px rgba(0,0,0,.3)}");
			s.push(".dco_modalTitle{font-size:14px;font-weight:650}");
			s.push(".dco_modalBody{color:" + UI.text2 + ";font-size:12.5px;line-height:1.65}");
			s.push(".dco_modalFoot{display:flex;justify-content:flex-end;gap:8px}");
			return s.join("\n");
		}

		function ensureSheet() {
			if (typeof document === "undefined" || document.head === null) return;
			if (document.querySelector('style[data-plugin-css="' + SHEET_TAG_ID + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = SHEET_TAG_ID;
			tag.textContent = sheetCss();
			document.head.appendChild(tag);
		}

		/* ================================================================== *
		 * CSS highlighter — a small tokenizer good enough for an editor
		 * overlay: comments, strings, at-rules, selectors, property names.
		 * ================================================================== */
		const CSS_TOKEN = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[-\w]+)|(\})|(^[ \t]*[^{\n;\/][^{\n;]*?(?=\s*\{))|([-\w]+(?=\s*:))|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ch)?\b)|(!important\b)/gm;
		/** HTML-escape one text chunk. */
		function escapeHtml(text) {
			return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		}
		/** Tokenize CSS into [{cls, text}] runs for the overlay. */
		function highlight(css) {
			const runs = [];
			let last = 0;
			CSS_TOKEN.lastIndex = 0;
			let match = CSS_TOKEN.exec(css);
			while (match !== null) {
				if (match.index > last) runs.push({ cls: "v", text: css.slice(last, match.index) });
				let cls = "v";
				if (match[1] !== undefined) cls = "c";
				else if (match[2] !== undefined) cls = "s";
				else if (match[3] !== undefined) cls = "a";
				else if (match[5] !== undefined) cls = "sel";
				else if (match[6] !== undefined) cls = "p";
				else if (match[7] !== undefined) cls = "s";
				else if (match[8] !== undefined) cls = "a";
				runs.push({ cls: cls, text: match[0] });
				last = match.index + match[0].length;
				match = CSS_TOKEN.exec(css);
			}
			if (last < css.length) runs.push({ cls: "v", text: css.slice(last) });
			return runs;
		}

		/* ================================================================== *
		 * Toasts
		 * ================================================================== */
		let toastHost = null;
		function toast(message) {
			if (typeof document === "undefined" || document.body === null) return;
			if (toastHost === null || toastHost.isConnected !== true) {
				toastHost = document.createElement("div");
				toastHost.className = "dco_toast";
				toastHost.dataset.plugin = PLUGIN_ID;
				document.body.appendChild(toastHost);
			}
			const item = document.createElement("div");
			item.className = "dco_toastItem";
			item.textContent = message;
			toastHost.appendChild(item);
			setTimeout(() => { if (item.parentNode !== null) item.parentNode.removeChild(item); }, 2600);
		}

		/* ================================================================== *
		 * Editor component
		 * ================================================================== */
		/** One rule row plus, when open, its editor. */
		function RuleRow(props) {
			const rule = props.rule;
			const open = props.open;
			const [renaming, setRenaming] = React.useState(false);
			const [draftName, setDraftName] = React.useState(rule.name);
			const [confirming, setConfirming] = React.useState(false);
			const textRef = React.useRef(null);
			const preRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			/* Draft CSS: the textarea's own value. It lives outside the store so
			   typing never round-trips through disk; "应用" commits it. */
			const [draft, setDraft] = React.useState(null);
			const value = draft === null ? rule.css : draft;
			const dirty = draft !== null && draft !== rule.css;

			React.useEffect(() => { setDraftName(rule.name); }, [rule.name]);

			const lines = value === "" ? 1 : value.split("\n").length;
			const runs = React.useMemo(() => highlight(value + "\n"), [value]);
			const highlightNodes = [];
			for (let i = 0; i < runs.length; i++) {
				highlightNodes.push(h("span", { key: i, className: "dco_tok-" + runs[i].cls }, runs[i].text));
			}

			/** Keep the transparent textarea, the colored overlay and the gutter in sync. */
			const syncScroll = () => {
				const area = textRef.current;
				if (area === null) return;
				if (preRef.current !== null) {
					preRef.current.scrollTop = area.scrollTop;
					preRef.current.scrollLeft = area.scrollLeft;
				}
				if (gutterRef.current !== null) gutterRef.current.scrollTop = area.scrollTop;
			};

			const commit = (css) => {
				props.onChange({ css: css, name: draftName, updatedAt: nowIso() });
				setDraft(null);
			};
			const discard = () => {
				setDraft(null);
				setDraftName(rule.name);
			};
			const onKeyDown = (event) => {
				if (event.key === "Tab") {
					event.preventDefault();
					const area = event.currentTarget;
					const start = area.selectionStart;
					const end = area.selectionEnd;
					const next = value.slice(0, start) + "  " + value.slice(end);
					setDraft(next);
					requestAnimationFrame(() => { area.selectionStart = area.selectionEnd = start + 2; });
					return;
				}
				if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
					event.preventDefault();
					commit(value);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					discard();
				}
			};

			const meta = [];
			meta.push(value.split("\n").length + " " + t("lineCount"));
			meta.push(value.length + " " + t("charCount"));

			return h("div", { className: "dco_item" + (open ? " dco_item--open" : "") },
				h("div", { className: "dco_row" },
					h("button", {
					type: "button",
					role: "switch",
					"aria-checked": rule.enabled === true,
					"aria-label": rule.name,
					title: t("enabledTip"),
					className: "dco_sw" + (rule.enabled === true ? " dco_sw--on" : ""),
					onClick: () => props.onToggle(!(rule.enabled === true)),
				}),
				h("div", { className: "dco_main" },
					h("div", { className: "dco_line" },
						renaming
							? h("input", {
								className: "dco_nameInput",
								autoFocus: true,
								value: draftName,
								onChange: (e) => setDraftName(e.target.value),
								onBlur: () => { setRenaming(false); if (draftName.trim() !== "" && draftName !== rule.name) props.onChange({ name: draftName.trim() }); },
								onKeyDown: (e) => {
									if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
									if (e.key === "Escape") { e.preventDefault(); setDraftName(rule.name); setRenaming(false); }
								},
							})
							: h("span", {
								className: "dco_name",
								title: t("rename"),
								onClick: () => setRenaming(true),
							}, rule.name),
						rule.css.trim() === ""
							? h("span", { className: "dco_badge" }, t("emptyCss").slice(0, 12) + "…")
							: null,
						rule.enabled === true
							? h("span", { className: "dco_badge dco_badge--on" }, t("on"))
							: h("span", { className: "dco_badge" }, t("off")),
						dirty ? h("span", { className: "dco_badge dco_badge--dirty" }, t("unsaved")) : null,
						h("span", { className: "dco_grow" }),
						h("span", { className: "dco_meta" }, meta.join(" · ")),
					),
					open ? null : (rule.css.trim() === ""
						? h("div", { className: "dco_preview dco_preview--empty" }, t("emptyCss"))
						: h("div", { className: "dco_preview" }, rule.css.split("\n").slice(0, 3).join("\n").slice(0, 220))),
				),
				h("div", { className: "dco_acts" },
					h("button", {
						type: "button",
						className: "dco_btn dco_btn--ghost dco_btn--icon",
						title: open ? t("apply") : t("edit"),
						"aria-label": open ? t("apply") : t("edit"),
						onClick: () => props.onOpen(!open),
					}, open ? "▾" : "▸"),
					h("button", {
						type: "button",
						className: "dco_btn dco_btn--ghost dco_btn--icon",
						title: t("duplicate"),
						"aria-label": t("duplicate"),
						onClick: () => props.onDuplicate(),
					}, "⧉"),
					h("button", {
						type: "button",
						className: "dco_btn dco_btn--ghost dco_btn--icon",
						title: t("del"),
						"aria-label": t("del"),
						onClick: () => setConfirming(true),
					}, "✕"),
					),
				),
				open ? h("div", { className: "dco_editor" },
					h("div", { className: "dco_codeWrap" },
						h("pre", { className: "dco_gutter", ref: gutterRef, "aria-hidden": true }, Array.from({ length: lines }, (_, i) => h("div", { key: i }, String(i + 1))).concat([h("div", { key: "pad" }, " ")])),
						h("div", { className: "dco_codeArea" },
							h("pre", { className: "dco_hl", ref: preRef, "aria-hidden": true }, highlightNodes),
							h("textarea", {
								className: "dco_code",
								ref: textRef,
								spellCheck: false,
								value: value,
								placeholder: t("cssPlaceholder"),
								"aria-label": t("title"),
								onChange: (e) => setDraft(e.target.value),
								onScroll: syncScroll,
								onKeyDown: onKeyDown,
								onBlur: () => { if (dirty) commit(value); },
							}),
						),
					),
					h("div", { className: "dco_editFoot" },
						h("button", {
							type: "button",
							className: "dco_btn dco_btn--primary",
							disabled: dirty === false,
							onClick: () => commit(value),
						}, t("apply")),
						h("button", {
							type: "button",
							className: "dco_btn",
							disabled: dirty === false,
							onClick: discard,
						}, t("discard")),
					),
				) : null,
				confirming ? h("div", { className: "dco_modal", role: "dialog", "aria-modal": true },
					h("div", { className: "dco_modalCard" },
						h("div", { className: "dco_modalTitle" }, t("delConfirm") + " · " + rule.name),
						h("div", { className: "dco_modalBody" }, t("delConfirmBody")),
						h("div", { className: "dco_modalFoot" },
							h("button", { type: "button", className: "dco_btn", onClick: () => setConfirming(false) }, t("cancel")),
							h("button", { type: "button", className: "dco_btn dco_btn--danger", onClick: () => { setConfirming(false); props.onDelete(); } }, t("delYes")),
						),
					),
				) : null,
			);
		}

		/* ================================================================== *
		 * The settings page
		 * ================================================================== */
		function OverridePage() {
			const store = useStore();
			/* Expanded row lives in the store (see setOpenId): it must survive
			   the re-renders that store notifications trigger. */
			const openId = store.openId === undefined ? null : store.openId;

			React.useEffect(() => {
				/* The store is loaded once at plugin start; re-pull on mount so
				   the page always opens on the file's current content. */
				loadFromHost();
			}, []);

			const rules = store.rules;
			const enabledCount = rules.filter((rule) => rule.enabled === true && rule.css.trim() !== "").length;
			const liveChars = rules.reduce((sum, rule) => (rule.enabled === true ? sum + rule.css.length : sum), 0);

			const add = () => {
				const rule = makeRule(t("newRuleName") + " " + (rules.length + 1), "");
				commit((list) => list.concat([rule]));
				setOpenId(rule.id);
			};
			const update = (id, patch) => commit((list) => list.map((rule) => (rule.id === id ? Object.assign({}, rule, patch, { updatedAt: nowIso() }) : rule)));
			const remove = (id) => {
				commit((list) => list.filter((rule) => rule.id !== id));
				setOpenId((current) => (current === id ? null : current));
			};
			const duplicate = (rule) => {
				const copy = Object.assign({}, rule, { id: newId(), name: rule.name + " " + t("duplicate"), updatedAt: nowIso() });
				commit((list) => {
					const index = list.findIndex((item) => item.id === rule.id);
					const next = list.slice();
					next.splice(index + 1, 0, copy);
					return next;
				});
				setOpenId(copy.id);
			};

			const exportCss = () => {
				try {
					const css = buildCss(rules);
					const blob = new Blob([css === "" ? "/* no enabled rule */\n" : css], { type: "text/css" });
					const url = URL.createObjectURL(blob);
					const link = document.createElement("a");
					link.href = url;
					link.download = "dsh-css-override.css";
					document.body.appendChild(link);
					link.click();
					link.remove();
					setTimeout(() => URL.revokeObjectURL(url), 4000);
					toast(t("exported"));
				} catch (error) {
					toast(String(error && error.message ? error.message : error));
				}
			};
			const copyPath = () => {
				const path = store.path;
				if (path === "") return;
				const done = () => toast(t("copied"));
				if (navigator.clipboard !== undefined && navigator.clipboard.writeText !== undefined) {
					navigator.clipboard.writeText(path).then(done, () => toast(t("copyFailed")));
					return;
				}
				toast(t("copyFailed"));
			};
			const reveal = () => {
				fetch(API_REVEAL, { method: "POST" }).then((response) => {
					if (!response.ok) toast("http " + response.status);
				}, (error) => toast(String(error && error.message ? error.message : error)));
			};
			const reload = () => {
				loadFromHost().then(() => toast(t("reloaded")));
			};

			const statusText = (() => {
				if (store.status === "saving") return t("saving");
				if (store.status === "offline") return t("offline");
				if (store.error !== "") return store.error;
				return t("saved");
			})();
			const dotClass = store.status === "saving" ? " dco_dot--busy"
				: store.status === "offline" || store.error !== "" ? " dco_dot--err"
					: store.hostOk ? " dco_dot--on" : "";

			return h("div", { className: "dco_root" },
				h("div", { className: "dco_card" },
					h("div", { className: "dco_head" },
						h("div", { className: "dco_h1" },
							h("span", { className: "dco_glyph" }, "{ }"),
							t("title"),
						),
						h("div", { className: "dco_sub" }, t("blurb")),
					),
					h("div", { className: "dco_bar" },
						h("button", { type: "button", className: "dco_btn dco_btn--primary", onClick: add }, "+ " + t("newRule")),
						h("button", { type: "button", className: "dco_btn", onClick: exportCss }, t("exportCss")),
						h("button", { type: "button", className: "dco_btn dco_btn--ghost", onClick: reload }, t("reload")),
						h("span", { className: "dco_grow" }),
						h("span", { className: "dco_chip" },
							h("span", { className: "dco_dot" + dotClass }),
							statusText,
						),
						h("span", { className: "dco_chip" }, rules.length + " " + t("statTotal") + " · " + enabledCount + " " + t("statOn") + " · " + liveChars + " " + t("statChars")),
					),
					rules.length === 0
						? h("div", { className: "dco_list" },
							h("div", { className: "dco_empty" },
								h("span", { className: "dco_emptyGlyph" }, "◫"),
								h("span", null, t("empty")),
								h("button", { type: "button", className: "dco_btn dco_btn--primary", onClick: add }, "+ " + t("newRule")),
							),
						)
						: h("div", { className: "dco_list" }, rules.map((rule) => h(RuleRow, {
								key: rule.id,
								rule: rule,
								open: openId === rule.id,
								onOpen: (next) => setOpenId(next ? rule.id : null),
								onToggle: (next) => update(rule.id, { enabled: next }),
								onChange: (patch) => update(rule.id, patch),
								onDelete: () => remove(rule.id),
								onDuplicate: () => duplicate(rule),
							}))),
					h("div", { className: "dco_pathRow" },
						h("span", null, t("pathLabel")),
						h("span", { className: "dco_path", title: store.path }, store.path === "" ? "—" : store.path),
						h("button", { type: "button", className: "dco_btn dco_btn--ghost", onClick: copyPath }, t("copyPath")),
						h("button", { type: "button", className: "dco_btn dco_btn--ghost", onClick: reveal }, t("reveal")),
					),
				),
				h("div", { className: "dco_note" },
					h("b", null, t("howtoTitle")),
					" — ",
					t("howtoBody"),
				),
			);
		}

		/* ================================================================== *
		 * Plugin entry
		 * ================================================================== */
		const inject = ["slots"];

		function apply(ctx) {
			ensureSheet();

			/* Locale: bind when the service exists, so the page follows the GUI
			   language; otherwise the built-in zh/en dictionary stands in. */
			try {
				const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
				if (locale !== undefined && locale !== null && typeof locale.bind === "function") {
					ctx.effect(() => {
						boundT = locale.bind("css-override");
						return () => { boundT = null; };
					}, "dsh-css-override: locale binding");
				}
			} catch { /* locale is optional */ }

			/* Settings page: one tab inside the Plugins settings section. */
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register(
				{ name: "settings.plugins.tab", id: "css-override", order: 40, label: () => t("tab") },
				OverridePage,
			));

			if (typeof document === "undefined") return;

			/* Startup: adopt the shadow immediately (so a reload keeps the user's
			   styling even before the host answers), then reconcile with the file. */
			const cached = shadowRead();
			if (cached !== null) {
				liveRules = cached;
				applyRules();
			}
			loadFromHost().then(() => applyRules(), () => applyRules());

			/* The shell may not have created <body> when a bundle runs early;
			   retry briefly until the injection point exists. */
			let tries = 0;
			const settle = setInterval(() => {
				tries += 1;
				applyRules();
				if (ruleTag !== null && ruleTag.isConnected === true) clearInterval(settle);
				else if (tries > 40) clearInterval(settle);
			}, 120);

			/* Cross-tab convergence: another window's save becomes visible here. */
			const onVisible = () => { if (document.hidden !== true) loadFromHost().then(() => applyRules(), () => undefined); };
			document.addEventListener("visibilitychange", onVisible);
			window.addEventListener("focus", onVisible);

			ctx.effect(() => () => {
				clearInterval(settle);
				document.removeEventListener("visibilitychange", onVisible);
				window.removeEventListener("focus", onVisible);
				if (ruleTag !== null) { ruleTag.remove(); ruleTag = null; }
				if (toastHost !== null) { toastHost.remove(); toastHost = null; }
			}, "dsh-css-override: injection engine");

			/* Debug handle: inspect / re-apply / reload from the console. */
			window.__dshCssOverride = {
				apply: () => { applyRules(); return buildCss(liveRules); },
				rules: () => snapshot().rules,
				reload: () => loadFromHost().then(() => applyRules()),
				path: () => rulesFilePathSafe(),
			};
		}

		function rulesFilePathSafe() {
			try { return snapshot().path; } catch { return ""; }
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
