// dsh-vision-suite — browser half.
//
// Intercepts image-only pastes on any editable surface and file drops onto
// the composer (a React-controlled textarea), uploads the bytes to the host
// route this plugin also ships, and inserts the returned absolute path as
// plain text instead of an attachment — so the model image-modality gate
// never triggers. Drops convert any file type; pastes stay image-only.
//
// Interception runs at document CAPTURE phase with stopImmediatePropagation,
// which beats the React root-delegated onPaste that would call intakeImages()
// and the composer's own document-level drop handler (dragenter/leave drive
// its full-page drop overlay, whose mask is pointer-events:none, and its drop
// handler would intake the files as attachments). A synthetic dragend resets
// that overlay, which the composer resets exactly that way on a real drop.
// A small chip in the shell overlay toggles the mode (persisted in
// localStorage): ON converts pastes/drops to paths, OFF restores native
// behavior.

window.__ModuleLoader__.load({
	id: "dsh-vision-suite",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		// ── mode store: "path" (convert) | "off" (native attachments) ──────────────
		const MODE_KEY = "dsh-vision-suite.mode";
		const listeners = new Set();
		const subscribe = (fn) => {
			listeners.add(fn);
			return () => { listeners.delete(fn); };
		};
		const getMode = () => (localStorage.getItem(MODE_KEY) === "off" ? "off" : "path");
		const setMode = (mode) => {
			localStorage.setItem(MODE_KEY, mode);
			for (const fn of listeners) fn();
		};

		// ── styles: chip + transient toast, themed via DSH CSS variables ──────────
		const css = [
			".dshPap_chip{position:fixed;right:16px;bottom:16px;z-index:60;display:inline-flex;align-items:center;gap:6px;padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;cursor:pointer;user-select:none;box-shadow:0 4px 14px rgba(0,0,0,.12)}",
			".dshPap_chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-bg-hover)}",
			".dshPap_chip .dshPap_dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}",
			".dshPap_chip.dshPap_off .dshPap_dot{background:var(--dsw-alias-label-tertiary)}",
			".dshPap_toast{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:70;padding:8px 14px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18)}"
		].join("\n");
		const cssTag = "dsh-vision-suite/chip.css";
		if (typeof document !== "undefined"
			&& document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTag) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-vision-suite";
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Transient toast; safe to call before any DOM readiness. */
		function toast(text) {
			if (typeof document === "undefined") return;
			const el = document.createElement("div");
			el.className = "dshPap_toast";
			el.textContent = text;
			document.body.appendChild(el);
			setTimeout(() => el.remove(), 2600);
		}

		// ── paste interception ─────────────────────────────────────────────────────
		/** The editable surface a paste targets, or null to not intercept. */
		function editableOf(target) {
			if (!(target instanceof Element)) return null;
			if (target.isContentEditable) return target;
			if (target.tagName === "TEXTAREA") return target;
			if (target.tagName === "INPUT") {
				const type = target.getAttribute("type") ?? "text";
				return type === "text" || type === "search" ? target : null;
			}
			return null;
		}

		/** Image files carried by one clipboard, grabbed before the event returns. */
		function imageFilesOf(clipboardData) {
			return Array.from(clipboardData.items)
				.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
				.map((item) => item.getAsFile())
				.filter((file) => file !== null);
		}

		/** Upload one image to the host route; resolves the saved absolute path. */
		async function saveToHost(file) {
			const buffer = await file.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			let binary = "";
			const CHUNK = 0x8000;
			for (let i = 0; i < bytes.length; i += CHUNK)
				binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
			const response = await fetch("/paste-as-path/save", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					mediaType: file.type || "",
					name: file.name || "",
					dataBase64: btoa(binary)
				})
			});
			const json = await response.json().catch(() => null);
			if (!response.ok || json === null || json.ok !== true)
				throw new Error(json?.error ?? "HTTP " + String(response.status));
			return json.path;
		}

		/**
		 * Insert text into a React-controlled input/textarea through the native
		 * value setter so the framework's onChange observes the change; the input
		 * event then carries the selection we restored for caret tracking.
		 */
		function insertIntoField(el, text, at) {
			const proto = el.tagName === "TEXTAREA"
				? window.HTMLTextAreaElement.prototype
				: window.HTMLInputElement.prototype;
			const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
			const value = el.value;
			const start = Math.min(at, value.length);
			const next = value.slice(0, start) + text + value.slice(start);
			if (setter !== undefined) setter.call(el, next);
			else el.value = next;
			const caret = start + text.length;
			try { el.setSelectionRange(caret, caret); } catch {}
			el.dispatchEvent(new Event("input", { bubbles: true }));
		}

		/** Insert at the caret for editable divs; focus restores the range. */
		function insertIntoEditable(el, text) {
			el.focus();
			document.execCommand("insertText", false, text);
		}

		/**
		 * Save every file, then insert the paths at the captured caret. For
		 * unfocused fields (a drop can land without focusing the textarea) the
		 * caret is unknown, so paths append at the end.
		 */
		async function convertFiles(el, files) {
			const isField = !el.isContentEditable;
			const focused = isField && document.activeElement === el;
			const caret = isField ? (focused ? (el.selectionStart ?? el.value.length) : el.value.length) : 0;
			const baseline = isField ? el.value : "";
			const paths = [];
			try {
				for (const file of files) paths.push(await saveToHost(file));
			} catch (error) {
				toast("文件保存失败：" + String(error?.message ?? error));
				return;
			}
			if (paths.length === 0) return;
			const text = paths.join("\n");
			if (!el.isConnected) {
				// The composer unmounted mid-save (session switched): fall back to clipboard.
				navigator.clipboard?.writeText(text);
				toast("文件已保存，路径已复制到剪贴板");
				return;
			}
			if (isField) {
				// If the draft changed while the upload was in flight, append at the end
				// rather than splicing into moved positions.
				const at = el.value === baseline ? caret : el.value.length;
				insertIntoField(el, (at === el.value.length && at > 0 ? "\n" : "") + text, at);
			} else {
				insertIntoEditable(el, text);
			}
		}

		/** Document-capture paste listener; see the header comment for ordering. */
		const onPaste = (event) => {
			if (getMode() !== "path") return;
			if (event.defaultPrevented) return;
			const el = editableOf(event.target);
			if (el === null) return;
			const clipboardData = event.clipboardData;
			if (clipboardData === null) return;
			const files = imageFilesOf(clipboardData);
			if (files.length === 0) return;
			const text = clipboardData.getData("text/plain");
			if (text !== null && text.trim() !== "") return; // mixed paste: native path
			event.preventDefault();
			event.stopImmediatePropagation();
			convertFiles(el, files);
		};

		// ── drop interception ──────────────────────────────────────────────────────
		/**
		 * The composer surface a drop targets: the editable element itself, or
		 * the composer card's textarea when the drop lands on card chrome
		 * (decoration backdrop, toolbar, attachments rail). The composer root
		 * exposes [data-composer-card] on its card node; the drop overlay mask
		 * is pointer-events:none, so drops always hit an element under it.
		 */
		function composerTextareaOf(target) {
			if (!(target instanceof Element)) return null;
			const editable = editableOf(target);
			if (editable !== null) return editable;
			const card = target.closest("[data-composer-card]");
			if (card === null) return null;
			return card.querySelector("textarea");
		}

		/** Files carried by one drop; folders and empty entries are skipped. */
		function droppedFilesOf(dataTransfer) {
			return Array.from(dataTransfer.files)
				.filter((file) => file !== null && file.size > 0);
		}

		/**
		 * Document-capture drag-over: allow the drop and show the copy cursor,
		 * short-circuiting the composer's own handler (which would otherwise
		 * mark the drop "none" while the model is busy). Drops are converted in
		 * any state, so the cursor must always say "convert".
		 */
		const onDragOver = (event) => {
			if (getMode() !== "path") return;
			if (event.defaultPrevented) return;
			if (composerTextareaOf(event.target) === null) return;
			const dataTransfer = event.dataTransfer;
			if (dataTransfer === null) return;
			const hasFiles = Array.from(dataTransfer.items).some((item) => item.kind === "file");
			if (!hasFiles) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			event.stopImmediatePropagation();
		};

		/**
		 * Document-capture drop: save every dropped file and insert the paths.
		 * stopImmediatePropagation beats the composer's document-level drop
		 * handler that would intake the files as attachments; the synthetic
		 * dragend performs the same overlay reset that handler would have done.
		 */
		const onDrop = (event) => {
			if (getMode() !== "path") return;
			if (event.defaultPrevented) return;
			const el = composerTextareaOf(event.target);
			if (el === null) return;
			const dataTransfer = event.dataTransfer;
			if (dataTransfer === null) return;
			const rawFiles = Array.from(dataTransfer.files).filter((file) => file !== null);
			if (rawFiles.length === 0) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			window.dispatchEvent(new Event("dragend"));
			const files = droppedFilesOf(dataTransfer);
			if (files.length === 0) {
				toast("没有可转换的文件（空文件与文件夹已跳过）");
				return;
			}
			convertFiles(el, files);
		};

		// ── toggle chip (shell overlay slot) ───────────────────────────────────────
		function PasteAsPathChip() {
			const mode = React.useSyncExternalStore(subscribe, getMode);
			const on = mode === "path";
			return h("button", {
				className: "dshPap_chip" + (on ? "" : " dshPap_off"),
				type: "button",
				title: on
					? "粘贴图片或拖入文件会保存为临时文件并在输入框插入路径（点击关闭，恢复附件模式）"
					: "粘贴图片/拖入文件走原生附件通道（点击开启路径模式）",
				"aria-label": "粘贴图片转路径模式",
				onClick: () => setMode(on ? "off" : "path")
			},
				h("span", { className: "dshPap_dot" }),
				on ? "图片→路径" : "图片→附件"
			);
		}

		// ── cordis client plugin ───────────────────────────────────────────────────
		const inject = ["slots"];
		function apply(ctx) {
			document.addEventListener("paste", onPaste, true);
			document.addEventListener("dragover", onDragOver, true);
			document.addEventListener("drop", onDrop, true);
			ctx.effect(() => () => {
				document.removeEventListener("paste", onPaste, true);
				document.removeEventListener("dragover", onDragOver, true);
				document.removeEventListener("drop", onDrop, true);
			}, "paste-as-path.pasteListener");
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{ name: "shell.overlay", id: "paste-as-path", order: 80 },
					PasteAsPathChip
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});