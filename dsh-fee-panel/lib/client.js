// dsh-fee-panel — client 面
//
// 官方 client bundle 协议：window.__ModuleLoader__.load({ id, factory })，
// factory 接收 require，返回 { apply, inject }（CJS 形态）。
// 数据通道：fetch 调 host 面注册的 webServer HTTP 路由
//   GET  /plugins/fee-panel/state
//   POST /plugins/fee-panel/refresh      { id? }
//   POST /plugins/fee-panel/set-key      { id, value }
//   POST /plugins/fee-panel/set-enabled  { id, enabled }
// UI：
//   - sidebar.footer.action（id: fee-panel）：紧凑 2×2 磁贴，无标题行，
//     点击磁贴 = 刷新该供应商；hover 出 Tooltip；窄轨（wide=false）退化为迷你竖排。
//   - settings.section（id: fee-panel）：顶部「侧栏显示」勾选 + 四张供应商凭据卡片。

window.__ModuleLoader__.load({
  id: "dsh-fee-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    // ── 样式注入（原生 DOM 模式，随插件生命周期常驻）────────────────────────
    var css = `
.fp-root{display:block;width:100%}
.fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:4px 0 6px}
.fp-tile{position:relative;display:flex;flex-direction:column;justify-content:space-between;height:40px;padding:3px 8px 5px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));cursor:pointer;user-select:none;transition:background .12s;text-align:left;border:none;width:100%;font:inherit;line-height:1;box-sizing:border-box}
.fp-tile:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
.fp-tile.dim{opacity:.55}
.fp-tile.busy .fp-val{animation:fp-pulse 1s ease-in-out infinite}
@keyframes fp-pulse{50%{opacity:.3}}
.fp-row{display:flex;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:4px;min-width:0;line-height:17px;height:17px}
.fp-name{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#4d6763);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.fp-val{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,#1e3a37);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.fp-sub{font-size:10px;color:var(--dsw-alias-label-tertiary,#7d938f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:12px;height:12px;margin-top:1px}
.fp-bar{height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08));overflow:hidden;margin-top:4px;flex:none}
.fp-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary,#2f9e8f)}
.fp-fill.warn{background:#d99a2b}
.fp-fill.crit{background:#d05b4b}
.fp-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:0;z-index:60;min-width:190px;max-width:250px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.12));box-shadow:0 8px 24px rgba(0,0,0,.16);font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary,#4d6763);white-space:pre-line;cursor:default;text-align:left;font-weight:400}
.fp-tile:hover .fp-tip{display:block}
/* 右列磁贴的 tooltip 反向朝左展开，避免溢出侧栏右缘被裁剪 */
.fp-grid .fp-tile:nth-child(even) .fp-tip{left:auto;right:0}
.fp-skel{height:8px;border-radius:4px;background:linear-gradient(90deg,rgba(0,0,0,.06) 25%,rgba(0,0,0,.12) 50%,rgba(0,0,0,.06) 75%);background-size:200% 100%;animation:fp-shimmer 1.4s infinite}
@keyframes fp-shimmer{to{background-position:-200% 0}}
.fp-rail{display:flex;flex-direction:column;gap:2px;padding:4px 0;width:100%;align-items:center}
.fp-rail-row{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);cursor:pointer;font-variant-numeric:tabular-nums;background:none;border:none;padding:1px 4px;border-radius:4px}
.fp-rail-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
.fp-page{display:flex;flex-direction:column;gap:8px;max-width:580px}
.fp-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fp-chip{font-size:11.5px;padding:3px 10px;border-radius:99px;cursor:pointer;border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.15));background:transparent;color:var(--dsw-alias-label-tertiary,#7d938f)}
.fp-chip.on{background:var(--dsw-alias-brand-primary,#2f9e8f);border-color:var(--dsw-alias-brand-primary,#2f9e8f);color:#fff}
.fp-desc{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#7d938f);line-height:1.6;margin:0}
.fp-card{border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.12));border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fff);display:flex;flex-direction:column;gap:6px}
.fp-card-head{display:flex;align-items:center;gap:7px}
.fp-card-name{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary,#1e3a37)}
.fp-badge{font-size:10px;padding:1px 7px;border-radius:99px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#4d6763);border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.1))}
.fp-st{font-size:10.5px;margin-left:auto;display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary,#4d6763)}
.fp-st i{width:6px;height:6px;border-radius:50%;display:inline-block;background:var(--dsw-alias-label-tertiary,#999)}
.fp-st.ok{color:#2f9e8f}.fp-st.ok i{background:#2f9e8f}
.fp-st.err{color:#d05b4b}.fp-st.err i{background:#d05b4b}
.fp-card-row{display:flex;gap:5px;align-items:flex-start}
.fp-input,.fp-textarea{flex:1;font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.15));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1e3a37);font-family:inherit;outline:none;min-width:0;box-sizing:border-box}
.fp-input:focus,.fp-textarea:focus{border-color:var(--dsw-alias-brand-primary,#2f9e8f)}
.fp-textarea{min-height:44px;resize:vertical;font-family:ui-monospace,Consolas,monospace}
.fp-btn{font-size:11.5px;padding:5px 10px;border-radius:7px;cursor:pointer;border:1px solid var(--dsw-alias-line-1,rgba(0,0,0,.15));background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary,#4d6763);white-space:nowrap}
.fp-btn:hover{filter:brightness(.96)}
.fp-btn:disabled{opacity:.5;cursor:default}
.fp-btn.primary{background:var(--dsw-alias-brand-primary,#2f9e8f);border-color:var(--dsw-alias-brand-primary,#2f9e8f);color:#fff}
.fp-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#7d938f);line-height:1.6;margin:0}
.fp-meta b{color:var(--dsw-alias-label-secondary,#4d6763);font-weight:600}
.fp-meta .ok{color:#2f9e8f}
.fp-meta .err{color:#d05b4b}
.fp-meta .hint{opacity:.85}
`;
    var tagId = "dsh-fee-panel/fee-panel.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-fee-panel";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 数据访问（webServer HTTP 路由）───────────────────────────────────────
    function unwrap(j) {
      if (!j || j.ok !== true) throw new Error((j && j.error) || "请求失败");
      return j;
    }

    function apiState() {
      return fetch("/plugins/fee-panel/state", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(unwrap);
    }

    function apiPost(path, body) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      })
        .then(function (r) { return r.json(); })
        .then(unwrap);
    }

    // ── 工具 ────────────────────────────────────────────────────────────────
    function p2(n) { return String(n).padStart(2, "0"); }

    function fmtTime(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var now = new Date();
      if (d.toDateString() === now.toDateString()) return p2(d.getHours()) + ":" + p2(d.getMinutes());
      return p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    }

    function credText(c) {
      if (!c) return "未配置";
      if (c.source === "custom") return "自定义 Key";
      if (c.source === "env") return "环境变量 " + c.ref;
      return "未配置";
    }

    function barClass(pct) {
      if (pct >= 90) return "crit";
      if (pct >= 70) return "warn";
      return "";
    }

    function tipText(p) {
      var lines = [p.label + " · " + p.kindLabel];
      if (Array.isArray(p.windows)) {
        for (var i = 0; i < p.windows.length; i++) {
          var w = p.windows[i];
          var prefix = w.monthly ? (w.label + "消耗 ") : (w.label + " 已用 ");
          var line = prefix + w.percent + "%";
          if (w.resetsAt) line += " · 重置 " + fmtTime(w.resetsAt);
          if (w.detail) line += " · " + w.detail;
          lines.push(line);
        }
      }
      if (p.balanceText) lines.push("余额 " + p.balanceText + (p.balanceDetail ? "（" + p.balanceDetail + "）" : ""));
      lines.push("凭据：" + credText(p.credential));
      if (p.error) lines.push("错误：" + p.error);
      if (p.updatedAt) lines.push("更新 " + fmtTime(p.updatedAt));
      lines.push("点击刷新 · 配置：设置 → 费用展示");
      return lines.join("\n");
    }

    // ── 组件 ────────────────────────────────────────────────────────────────
    function useFeeState(ctx) {
      var stateHook = React.useState(null);
      var state = stateHook[0];
      var setState = stateHook[1];
      var busyHook = React.useState("");
      var busy = busyHook[0];
      var setBusy = busyHook[1];
      var load = function () {
        apiState().then(function (s) { setState({ providers: s.providers }); }).catch(function () {});
      };
      React.useEffect(function () {
        load();
        return ctx.interval(load, 15000);
      }, []);
      var refresh = function (id) {
        if (busy !== "") return;
        setBusy(id || "all");
        apiPost("/plugins/fee-panel/refresh", id ? { id: id } : {})
          .then(function (s) { setState({ providers: s.providers }); })
          .catch(function () {})
          .then(function () { setBusy(""); });
      };
      return { state: state, busy: busy, refresh: refresh, setState: setState };
    }

    function Tile(props) {
      var p = props.p;
      var busy = props.busy;
      var value = null;
      var sub = null;
      var bar = null;
      var dim = false;
      if (p.status === "ok") {
        if (p.quota !== null && p.quota !== undefined) {
          value = Math.round(p.quota.percent) + "%";
          bar = React.createElement("div", { className: "fp-bar" },
            React.createElement("div", { className: "fp-fill " + barClass(p.quota.percent), style: { width: Math.max(2, p.quota.percent) + "%" } }));
        } else if (p.balanceText) {
          value = p.balanceText;
          sub = p.balanceDetail || "余额";
        } else {
          value = "—";
        }
      } else if (p.status === "error") {
        dim = true;
        if (p.quota !== null && p.quota !== undefined) {
          value = "⏱ " + Math.round(p.quota.percent) + "%";
          bar = React.createElement("div", { className: "fp-bar" },
            React.createElement("div", { className: "fp-fill " + barClass(p.quota.percent), style: { width: Math.max(2, p.quota.percent) + "%" } }));
        } else if (p.balanceText) {
          value = "⏱ " + p.balanceText;
        } else {
          value = "!";
          sub = "刷新失败";
        }
      } else if (p.status === "no-key") {
        value = "—";
        sub = p.inputType === "cookie" ? "未配置 Cookie" : "未配置 Key";
      } else {
        value = "…";
      }
      var children = [React.createElement("div", { className: "fp-row" },
        React.createElement("span", { className: "fp-name" }, p.short),
        React.createElement("span", { className: "fp-val" }, value))];
      if (bar !== null) children.push(bar);
      else if (sub !== null) children.push(React.createElement("div", { className: "fp-sub" }, sub));
      children.push(React.createElement("div", { className: "fp-tip" }, tipText(p)));
      return React.createElement("button", {
        type: "button",
        className: "fp-tile" + (dim ? " dim" : "") + (busy ? " busy" : ""),
        onClick: props.onClick,
      }, children);
    }

    function FeeBar(props) {
      var wide = props.wide !== false;
      var s = useFeeState(props.ctx);
      var state = s.state;
      var busy = s.busy;
      var refresh = s.refresh;
      if (state === null) {
        return React.createElement("div", { className: "fp-root" },
          React.createElement("div", { className: "fp-grid" }, [0, 1, 2, 3].map(function (i) {
            return React.createElement("div", { key: i, className: "fp-tile", style: { cursor: "default" } },
              React.createElement("div", { className: "fp-row" },
                React.createElement("span", { className: "fp-name" }, "…")),
              React.createElement("div", { className: "fp-skel", style: { width: "60%" } }));
          })));
      }
      var shown = state.providers.filter(function (p) { return p.enabled !== false; });
      if (shown.length === 0) return null;
      if (!wide) {
        return React.createElement("div", { className: "fp-rail" }, shown.map(function (p) {
          return React.createElement("button", {
            key: p.id, type: "button", className: "fp-rail-row",
            onClick: function () { refresh(p.id); }, title: tipText(p),
          }, p.short.slice(0, 3) + " " + (p.quota != null ? Math.round(p.quota.percent) + "%" : (p.balanceText || "—")));
        }));
      }
      return React.createElement("div", { className: "fp-root" },
        React.createElement("div", { className: "fp-grid" }, shown.map(function (p) {
          return React.createElement(Tile, { key: p.id, p: p, busy: busy === p.id, onClick: function () { refresh(p.id); } });
        })));
    }

    function ProviderCard(props) {
      var p = props.p;
      var draftHook = React.useState("");
      var draft = draftHook[0];
      var setDraft = draftHook[1];
      var showHook = React.useState(false);
      var show = showHook[0];
      var setShow = showHook[1];
      var savingHook = React.useState(false);
      var saving = savingHook[0];
      var setSaving = savingHook[1];
      var apply = function (value) {
        setSaving(true);
        apiPost("/plugins/fee-panel/set-key", { id: p.id, value: value })
          .then(function (s) { props.onState({ providers: s.providers }); setDraft(""); })
          .catch(function () {})
          .then(function () { setSaving(false); });
      };
      var stClass = p.status === "ok" ? "ok" : (p.status === "error" ? "err" : "");
      var stText = p.status === "ok" ? "正常" : (p.status === "error" ? "异常" : (p.status === "no-key" ? "未配置" : "加载中"));
      var isCookie = p.inputType === "cookie";
      var placeholder = isCookie
        ? "粘贴控制台 Cookie 头（含 api-platform_serviceToken=\"...\"）"
        : "未设置，将使用环境变量 " + p.envRef;
      var resultText = null;
      if (p.error) {
        resultText = React.createElement("span", { className: "err" }, "最近：" + p.error);
      } else if (p.status === "ok") {
        var parts = [];
        if (Array.isArray(p.windows)) {
          for (var i = 0; i < p.windows.length && i < 2; i++) parts.push(p.windows[i].label + " " + p.windows[i].percent + "%");
        }
        if (p.balanceText) parts.push("余额 " + p.balanceText);
        resultText = React.createElement("span", { className: "ok" },
          "最近：" + (parts.length > 0 ? parts.join(" · ") : "正常") + (p.updatedAt ? " · " + fmtTime(p.updatedAt) + " ✓" : ""));
      }
      return React.createElement("div", { className: "fp-card" },
        React.createElement("div", { className: "fp-card-head" },
          React.createElement("span", { className: "fp-card-name" }, p.label),
          React.createElement("span", { className: "fp-badge" }, p.kindLabel),
          React.createElement("span", { className: "fp-st " + stClass }, React.createElement("i", null), stText)),
        isCookie
          ? React.createElement("textarea", { className: "fp-textarea", value: draft, placeholder: placeholder, onChange: function (e) { setDraft(e.target.value); }, spellCheck: false })
          : React.createElement("div", { className: "fp-card-row" },
              React.createElement("input", {
                className: "fp-input", type: show ? "text" : "password", value: draft, placeholder: placeholder,
                onChange: function (e) { setDraft(e.target.value); }, spellCheck: false,
              }),
              React.createElement("button", { type: "button", className: "fp-btn", onClick: function () { setShow(!show); } }, show ? "隐藏" : "👁")),
        React.createElement("div", { className: "fp-card-row", style: { justifyContent: "flex-end" } },
          React.createElement("button", { type: "button", className: "fp-btn primary", disabled: draft.trim() === "" || saving, onClick: function () { apply(draft.trim()); } }, saving ? "处理中…" : "保存并刷新"),
          React.createElement("button", { type: "button", className: "fp-btn", disabled: saving, onClick: function () { apply(""); } }, "清除")),
        React.createElement("p", { className: "fp-meta" },
          "来源：", React.createElement("b", null, credText(p.credential)), resultText,
          React.createElement("br", null),
          React.createElement("span", { className: "hint" }, p.hint)));
    }

    function SettingsPage(props) {
      var ctx = props.ctx;
      var s = useFeeState(ctx);
      var state = s.state;
      var busy = s.busy;
      var refresh = s.refresh;
      var setState = s.setState;
      if (state === null) {
        return React.createElement("div", { className: "fp-page" },
          React.createElement("div", { className: "fp-skel", style: { height: "120px", width: "100%" } }));
      }
      var toggle = function (p) {
        apiPost("/plugins/fee-panel/set-enabled", { id: p.id, enabled: !(p.enabled !== false) })
          .then(function (r) { setState({ providers: r.providers }); })
          .catch(function () {});
      };
      return React.createElement("div", { className: "fp-page" },
        React.createElement("div", { className: "fp-top" },
          React.createElement("span", { className: "fp-desc" }, "侧栏显示："),
          state.providers.map(function (p) {
            var on = p.enabled !== false;
            return React.createElement("button", {
              key: p.id, type: "button",
              className: "fp-chip" + (on ? " on" : ""),
              onClick: function () { toggle(p); },
            }, (on ? "☑ " : "☐ ") + p.short);
          }),
          React.createElement("span", { style: { flex: 1 } }),
          React.createElement("button", {
            type: "button", className: "fp-btn", disabled: busy !== "", onClick: function () { refresh(""); },
          }, busy === "all" ? "刷新中…" : "全部刷新 ↻")),
        React.createElement("p", { className: "fp-desc" },
          "凭据保存到本机凭据库（不可写时仅存内存）；未设置时自动使用环境变量。点击侧栏磁贴可单独刷新。"),
        state.providers.map(function (p) {
          return React.createElement(ProviderCard, { key: p.id, p: p, onState: setState });
        }));
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    var inject = ["slots", "timer"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots) {
        slots.inject("sidebar.footer.action", function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "fee-panel", order: 5, label: "费用" },
            function (props) { return React.createElement(FeeBar, { wide: props.wide, ctx: ctx }); }
          );
        });
        slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "fee-panel", order: 31, label: "费用展示" },
            function () { return React.createElement(SettingsPage, { ctx: ctx }); }
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
