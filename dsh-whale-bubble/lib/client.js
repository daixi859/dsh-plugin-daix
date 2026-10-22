// dsh-whale-bubble — client 面
//
// 官方 client bundle 协议：window.__ModuleLoader__.load({ id, factory })，
// factory 接收 require，返回 { apply, inject }（CJS 形态）。
// 数据通道：fetch 调 host 面注册的 webServer HTTP 路由
//   GET  /plugins/whale-bubble/state
//   POST /plugins/whale-bubble/refresh      { id? }
//   POST /plugins/whale-bubble/set-key      { id, value }
//   POST /plugins/whale-bubble/set-visible  { visible }
// UI（挂 shell.overlay，整页右下角 fixed）：
//   - 收起态：38px 圆形半透明鲸鱼图标（hover 实体化）；点击图标 = 强制刷新（转圈）
//   - hover 卡片：工作区名/目录 + Z.ai 5h 窗口（百分比+重置时间）+ DeepSeek 余额；
//     卡片右上 ⚙ 打开内联配置弹层；错误红点角标、no-key 降饱和
//   - 配置弹层：双 Key 输入 + 显示开关，✕ 关闭
//   - 无刷新按钮/更新时间/扩展区 UI（数据面预留 extraRows）

window.__ModuleLoader__.load({
  id: "dsh-whale-bubble",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    var WHALE_VIEWBOX = "0 0 27 23";
    var WHALE_LOGO_PATH =
      "M26.5174 3.39471C26.235 3.2567 26.1137 3.52006 25.9487 3.65346C25.8923 3.69659 25.8446 3.75294 25.7969 3.80469C25.3846 4.24516 24.9027 4.53439 24.2737 4.49989C23.3536 4.44814 22.5682 4.73737 21.8735 5.44119C21.7258 4.57349 21.2353 4.0554 20.4889 3.72304C20.0985 3.55054 19.7034 3.37746 19.4297 3.00197C19.2388 2.73459 19.1865 2.43673 19.091 2.14289C19.0301 1.96579 18.9697 1.78466 18.7656 1.75418C18.5442 1.71968 18.4574 1.90541 18.3705 2.06067C18.0232 2.69549 17.8887 3.39471 17.9019 4.10313C17.9324 5.6965 18.6051 6.96556 19.9421 7.86834C20.0939 7.97184 20.133 8.07535 20.0852 8.22658C19.9938 8.53766 19.8857 8.83955 19.7903 9.15063C19.7293 9.34901 19.6384 9.39271 19.4257 9.30588C18.692 8.9994 18.0583 8.54571 17.4982 7.99772C16.5477 7.07827 15.6881 6.06336 14.6162 5.26869C14.3644 5.08296 14.1125 4.91045 13.8521 4.746C12.7584 3.68394 13.9952 2.81164 14.2816 2.70814C14.5812 2.60003 14.3857 2.22857 13.4179 2.23317C12.4502 2.2372 11.5646 2.56151 10.4359 2.99335C10.2708 3.05832 10.0972 3.10547 9.91951 3.14457C8.8954 2.95022 7.83162 2.90709 6.72069 3.03245C4.62877 3.26533 2.95777 4.25436 1.72954 5.94261C0.254043 7.97184 -0.0932678 10.2777 0.33167 12.6824C0.778458 15.2171 2.07225 17.3153 4.06008 18.9558C6.12152 20.6567 8.49577 21.4905 11.2047 21.3306C12.8498 21.2358 14.6812 21.0155 16.7473 19.2669C17.2682 19.5262 17.8151 19.6297 18.7219 19.7074C19.4205 19.7723 20.0933 19.6729 20.6143 19.5648C21.4302 19.3923 21.3739 18.6367 21.0789 18.4981C18.6874 17.3843 19.2124 17.8374 18.7351 17.4706C19.9501 16.033 21.8063 13.4776 22.379 9.99821C22.4353 9.61409 22.5072 9.073 22.4986 8.76192C22.494 8.57216 22.5377 8.49856 22.7545 8.47671C23.3536 8.40771 23.935 8.24383 24.4692 7.94999C26.0188 7.10357 26.6439 5.71318 26.7911 4.04678C26.8129 3.79204 26.7865 3.52869 26.5174 3.39471ZM13.0143 18.3946C10.6964 16.5724 9.5722 15.9726 9.10816 15.9985C8.67402 16.0244 8.75222 16.5212 8.84768 16.8449C8.94773 17.1646 9.07768 17.3849 9.25996 17.6655C9.38589 17.8512 9.47272 18.1272 9.13404 18.3348C8.38766 18.7965 7.08985 18.1796 7.0289 18.1491C5.51833 17.2595 4.25559 16.0853 3.36546 14.4793C2.50581 12.9337 2.0067 11.2753 1.92447 9.50542C1.90262 9.07818 2.02855 8.92695 2.45406 8.84932C3.01413 8.74582 3.59144 8.72397 4.15093 8.80619C6.51656 9.15178 8.53027 10.2092 10.2185 11.8848C11.1822 12.8388 11.9114 13.979 12.6623 15.0929C13.461 16.2757 14.3201 17.4027 15.4144 18.3268C15.8008 18.6505 16.109 18.8966 16.404 19.0783C15.5144 19.1778 14.0297 19.1991 13.0143 18.3958V18.3946ZM14.1252 11.2489C14.1252 11.0591 14.277 10.9079 14.4679 10.9079C14.511 10.9079 14.5501 10.9165 14.5852 10.9292C14.6329 10.9464 14.6766 10.9723 14.7111 11.0114C14.7721 11.0718 14.8066 11.158 14.8066 11.2489C14.8066 11.4386 14.6548 11.5899 14.4639 11.5899C14.273 11.5899 14.1252 11.4386 14.1252 11.2489ZM17.5759 13.0188C17.3545 13.1096 17.1331 13.1873 16.9203 13.1959C16.5903 13.2131 16.2303 13.0791 16.0348 12.9153C15.7312 12.6605 15.5139 12.5179 15.423 12.0734C15.3839 11.8837 15.4057 11.5899 15.4402 11.4214C15.5185 11.0585 15.4316 10.8257 15.1757 10.614C14.9676 10.4415 14.7025 10.3938 14.4115 10.3938C14.3029 10.3938 14.2034 10.3461 14.1292 10.3076C14.0079 10.2472 13.9078 10.096 14.0033 9.91023C14.0338 9.84985 14.1815 9.70322 14.216 9.67734C14.6111 9.45251 15.0665 9.52612 15.488 9.6946C15.8784 9.85445 16.174 10.1477 16.5989 10.5623C17.033 11.0631 17.1112 11.2011 17.3585 11.5772C17.554 11.871 17.7317 12.1729 17.8536 12.5185C17.9272 12.7341 17.8317 12.9107 17.5759 13.0188Z";

    // ── 样式注入（原生 DOM 模式，随插件生命周期常驻）────────────────────────
    var css = `
.wb-root{position:fixed;right:20px;bottom:20px;z-index:9000;font-family:inherit}
.wb-whale{width:32px;height:32px;corner-shape:round;border-radius:50%;overflow:hidden;background:var(--dsw-alias-bg-layer,#fff);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 2px 10px rgba(0,0,0,.10);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;opacity:.55;transition:opacity .18s,transform .18s,box-shadow .18s;user-select:none;padding:0}
.wb-whale:hover{opacity:1;transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.14)}
.wb-whale svg{width:17px;height:17px;color:#4D6BFE;display:block}
.wb-whale .wb-dot{position:absolute;right:0;bottom:0;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error,#d9483b);border:2px solid var(--dsw-alias-bg-layer,#fff);display:none;z-index:2}
.wb-whale.wb-err .wb-dot{display:block}
.wb-whale.wb-nokey svg{filter:grayscale(1) opacity(.6)}
.wb-whale .wb-spin{position:absolute;inset:-1px;corner-shape:round;border-radius:50%;border:2px solid rgba(74,125,255,.22);border-top-color:var(--dsw-alias-brand-primary,#4a7dff);animation:wb-rot .8s linear infinite;display:none;pointer-events:none}
.wb-whale.wb-refreshing .wb-spin{display:block}
@keyframes wb-rot{to{transform:rotate(360deg)}}
.wb-card{position:fixed;right:20px;bottom:58px;width:218px;border-radius:10px;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.92));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 8px 28px rgba(0,0,0,.14);padding:9px 11px 7px;font-size:11.5px;line-height:1.4;animation:wb-pop .16s ease-out;color:var(--dsw-alias-label-primary,#1a1a1a)}
@keyframes wb-pop{from{opacity:0;transform:translateY(6px)}}
.wb-ws{display:flex;align-items:center;gap:5px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));margin-bottom:5px}
.wb-gear{margin-left:auto;flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#8a8a85);cursor:pointer;font-size:13px;border:none;background:transparent;padding:0}
.wb-gear:hover{background:var(--dsw-alias-border-l1,rgba(0,0,0,.08));color:var(--dsw-alias-brand-primary,#4a7dff)}
.wb-wsname{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-wsdir{color:var(--dsw-alias-label-secondary,#8a8a85);font-size:11px;flex:none}
.wb-row{display:flex;justify-content:space-between;align-items:center;padding:2px 0}
.wb-prov{color:var(--dsw-alias-label-secondary,#8a8a85);flex:none;width:74px}
.wb-val{font-variant-numeric:tabular-nums;text-align:right;flex:1}
.wb-val small{color:var(--dsw-alias-label-secondary,#8a8a85);font-size:10px;margin-left:5px}
.wb-meter{height:3px;border-radius:2px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08));margin:2px 0 4px;overflow:hidden}
.wb-meter i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-success,#2fa36b)}
.wb-meter i.w{background:var(--dsw-alias-state-warning,#d98a1f)}
.wb-meter i.e{background:var(--dsw-alias-state-error,#d9483b)}
.wb-errline{color:var(--dsw-alias-state-error,#d9483b);font-size:11px;margin-top:4px;word-break:break-all}
.wb-na{color:var(--dsw-alias-label-secondary,#8a8a85);font-size:11px;padding:3px 0}
.wb-cfg{position:fixed;right:20px;bottom:68px;width:268px;border-radius:12px;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.92));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 8px 28px rgba(0,0,0,.14);padding:14px;font-size:12.5px;animation:wb-pop .16s ease-out;color:var(--dsw-alias-label-primary,#1a1a1a)}
.wb-cfg h3{font-size:13px;margin:0 0 10px;display:flex;justify-content:space-between;align-items:center;font-weight:600}
.wb-cfg .wb-x{cursor:pointer;color:var(--dsw-alias-label-secondary,#8a8a85);font-size:15px;line-height:1;border:none;background:transparent;padding:0}
.wb-cfg label{display:block;color:var(--dsw-alias-label-secondary,#8a8a85);font-size:11px;margin:9px 0 3px}
.wb-cfg input[type=password],.wb-cfg input[type=text]{width:100%;font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:7px;background:var(--dsw-alias-bg-layer,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);outline:none;box-sizing:border-box}
.wb-cfg input:focus{border-color:var(--dsw-alias-brand-primary,#4a7dff)}
.wb-kstat{font-size:10.5px;margin-top:3px}
.wb-kstat.ok{color:var(--dsw-alias-state-success,#2fa36b)}
.wb-kstat.err{color:var(--dsw-alias-state-error,#d9483b)}
.wb-kstat.na{color:var(--dsw-alias-label-secondary,#8a8a85)}
.wb-switchrow{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
.wb-switch{width:32px;height:18px;border-radius:9px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.14));position:relative;cursor:pointer;transition:background .15s;border:none;padding:0}
.wb-switch.on{background:var(--dsw-alias-state-success,#2fa36b)}
.wb-switch i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}
.wb-switch.on i{left:16px}
.wb-save{width:100%;margin-top:14px;font:inherit;font-size:12.5px;padding:7px 0;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary,#4a7dff);color:#fff;cursor:pointer}
.wb-save:disabled{opacity:.55;cursor:default}
.wb-hint{color:var(--dsw-alias-label-secondary,#8a8a85);font-size:10.5px;margin-top:8px;line-height:1.5}
`;
    var tagId = "dsh-whale-bubble/whale-bubble.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-whale-bubble";
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
      return fetch("/plugins/whale-bubble/state", { cache: "no-store" })
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

    function barClass(pct) {
      if (pct >= 90) return " e";
      if (pct >= 70) return " w";
      return "";
    }

    function dirTail(path) {
      if (!path) return "";
      var parts = String(path).replace(/[\\/]+$/, "").split(/[\\/]/);
      var tail = parts.pop() || "";
      if (parts.length === 0) return tail;
      var head = parts[0];
      return head + "\\…\\" + tail;
    }

    function WhaleIcon() {
      return React.createElement("svg", { viewBox: WHALE_VIEWBOX, fill: "currentColor", "aria-hidden": true },
        React.createElement("path", { d: WHALE_LOGO_PATH }));
    }

    // ── 悬浮卡片 ────────────────────────────────────────────────────────────
    function ProviderRow(props) {
      var p = props.p;
      if (p.status === "ok") {
        if (p.quota !== null && p.quota !== undefined) {
          var pct = p.quota.percent;
          var val = [pct + "%"];
          if (p.quota.resetsAt) val.push(React.createElement("small", { key: "r" }, fmtTime(p.quota.resetsAt) + " 重置"));
          return [
            React.createElement("div", { className: "wb-row", key: "row" },
              React.createElement("span", { className: "wb-prov" }, p.short),
              React.createElement("span", { className: "wb-val" }, val)),
            React.createElement("div", { className: "wb-meter", key: "meter" },
              React.createElement("i", { className: barClass(pct), style: { width: Math.max(2, pct) + "%" } })),
          ];
        }
        if (p.balanceText) {
          return React.createElement("div", { className: "wb-row", key: "row" },
            React.createElement("span", { className: "wb-prov" }, p.short),
            React.createElement("span", { className: "wb-val" }, p.balanceText));
        }
        return React.createElement("div", { className: "wb-row", key: "row" },
          React.createElement("span", { className: "wb-prov" }, p.short),
          React.createElement("span", { className: "wb-val" }, "—"));
      }
      if (p.status === "no-key") {
        return React.createElement("div", { className: "wb-row", key: "row" },
          React.createElement("span", { className: "wb-prov" }, p.short),
          React.createElement("span", { className: "wb-val" }, "未配置"));
      }
      return React.createElement("div", { className: "wb-row", key: "row" },
        React.createElement("span", { className: "wb-prov" }, p.short),
        React.createElement("span", { className: "wb-val" }, "…"));
    }

    function HoverCard(props) {
      var s = props.state;
      var providers = s.providers || [];
      var ws = s.workspace || { title: "", path: "" };
      var errors = providers.filter(function (p) { return p.status === "error" && p.error; });
      return React.createElement("div", { className: "wb-card" },
        React.createElement("div", { className: "wb-ws" },
          React.createElement("span", { className: "wb-wsname", title: ws.path || "" }, ws.title || "—"),
          React.createElement("span", { className: "wb-wsdir", title: ws.path || "" }, "📁 " + dirTail(ws.path)),
          React.createElement("button", {
            type: "button", className: "wb-gear", title: "配置",
            onClick: function (e) { e.stopPropagation(); props.onOpenCfg(); },
          }, "⚙")),
        providers.map(function (p) { return React.createElement(ProviderRow, { key: p.id, p: p }); }),
        errors.length > 0
          ? React.createElement("div", { className: "wb-errline" }, errors[0].short + "：" + errors[0].error)
          : null);
    }

    // ── 配置弹层 ────────────────────────────────────────────────────────────
    function KeyField(props) {
      var p = props.p;
      var draftHook = React.useState(undefined);
      var draft = draftHook[0];
      var setDraft = draftHook[1];
      var value = draft === undefined ? "" : draft;
      var kstat = null;
      if (p.status === "ok") {
        var parts = [];
        if (p.quota != null) parts.push("5h 已用 " + p.quota.percent + "%");
        if (p.balanceText) parts.push("余额 " + p.balanceText);
        kstat = React.createElement("div", { className: "wb-kstat ok" },
          "✓ 有效" + (parts.length > 0 ? " · " + parts.join(" · ") : ""));
      } else if (p.status === "error") {
        kstat = React.createElement("div", { className: "wb-kstat err" }, "✕ " + (p.error || "查询失败"));
      } else if (p.status === "no-key") {
        kstat = React.createElement("div", { className: "wb-kstat na" }, "未配置，回落环境变量 " + p.envRef);
      } else {
        kstat = React.createElement("div", { className: "wb-kstat na" }, "加载中…");
      }
      return React.createElement("div", null,
        React.createElement("label", null, p.label + " API Key"),
        React.createElement("input", {
          type: "password", value: value, spellCheck: false, autoComplete: "off",
          placeholder: "留空使用 " + p.envRef,
          onChange: function (e) { setDraft(e.target.value); },
        }),
        kstat,
        props.saveError
          ? React.createElement("div", { className: "wb-kstat err" }, props.saveError)
          : null);
    }

    function ConfigPanel(props) {
      var s = props.state;
      var providers = s.providers || [];
      var savingHook = React.useState(false);
      var saving = savingHook[0];
      var setSaving = savingHook[1];
      var saveErrorHook = React.useState("");
      var saveError = saveErrorHook[0];
      var setSaveError = saveErrorHook[1];
      var save = function () {
        var inputs = Array.prototype.slice.call(
          document.querySelectorAll(".wb-cfg input[data-wb-provider]"));
        var calls = [];
        for (var i = 0; i < inputs.length; i++) {
          var v = String(inputs[i].value || "").trim();
          if (v !== "") calls.push(apiPost("/plugins/whale-bubble/set-key", { id: inputs[i].dataset.wbProvider, value: v }));
        }
        if (calls.length === 0) return;
        setSaving(true);
        setSaveError("");
        Promise.all(calls)
          .then(function (results) { props.onState(results[results.length - 1]); })
          .catch(function (e) { setSaveError("保存失败：" + (e && e.message ? e.message : e)); })
          .then(function () { setSaving(false); });
      };
      return React.createElement("div", { className: "wb-cfg" },
        React.createElement("h3", null, "鲸鱼气泡设置",
          React.createElement("button", { type: "button", className: "wb-x", onClick: props.onClose }, "✕")),
        providers.map(function (p) {
          return React.createElement(KeyField, { key: p.id, p: p, saveError: "" });
        }),
        React.createElement("div", { className: "wb-switchrow" },
          React.createElement("span", null, "显示气泡"),
          React.createElement("button", {
            type: "button",
            className: "wb-switch" + (s.visible !== false ? " on" : ""),
            onClick: function () {
              apiPost("/plugins/whale-bubble/set-visible", { visible: !(s.visible !== false) })
                .then(function (r) { props.onState(r); })
                .catch(function () {});
            },
          }, React.createElement("i", null))),
        React.createElement("button", { type: "button", className: "wb-save", disabled: saving, onClick: save },
          saving ? "保存中…" : "保存 Key 并刷新"),
        React.createElement("div", { className: "wb-hint" },
          "Key 保存到本机凭据库；未填写时使用环境变量。数据每 5 分钟自动刷新。"));
    }

    // ── 气泡主体 ────────────────────────────────────────────────────────────
    function WhaleBubble(props) {
      var ctx = props.ctx;
      var stateHook = React.useState(null);
      var state = stateHook[0];
      var setState = stateHook[1];
      var hoverHook = React.useState(false);
      var hover = hoverHook[0];
      var setHover = hoverHook[1];
      var cfgOpenHook = React.useState(false);
      var cfgOpen = cfgOpenHook[0];
      var setCfgOpen = cfgOpenHook[1];
      var refreshingHook = React.useState(false);
      var refreshing = refreshingHook[0];
      var setRefreshing = refreshingHook[1];
      // 离开延迟：鼠标从图标斜向移向卡片时短暂离开所有子元素，不立即收卡
      var leaveTimer = React.useRef(null);

      var load = function () {
        return apiState().then(function (s) { setState(s); }).catch(function () {});
      };

      React.useEffect(function () {
        load();
        return ctx.interval(load, 15000);
      }, []);

      // 配置弹层打开期间锁定 hover 展示，避免移出即消失
      var showCard = hover || cfgOpen;

      var refresh = function () {
        if (refreshing) return;
        setRefreshing(true);
        apiPost("/plugins/whale-bubble/refresh", {})
          .then(function (s) { setState(s); })
          .catch(function () {})
          .then(function () { setRefreshing(false); });
      };

      if (state === null) return null;
      if (state.visible === false) return null;

      var providers = state.providers || [];
      var hasError = providers.some(function (p) { return p.status === "error"; });
      var allNoKey = providers.length > 0 && providers.every(function (p) { return p.status === "no-key"; });

      return React.createElement("div", {
        className: "wb-root",
        onMouseEnter: function () {
          if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
          setHover(true);
        },
        onMouseLeave: function () {
          if (leaveTimer.current) clearTimeout(leaveTimer.current);
          leaveTimer.current = setTimeout(function () { setHover(false); leaveTimer.current = null; }, 150);
        },
      },
        React.createElement("button", {
          type: "button",
          className: "wb-whale" + (hasError ? " wb-err" : "") + (allNoKey ? " wb-nokey" : "") + (refreshing ? " wb-refreshing" : ""),
          title: "鲸鱼气泡（点击强制刷新）",
          onClick: refresh,
        },
          React.createElement(WhaleIcon, null),
          React.createElement("span", { className: "wb-dot" }),
          React.createElement("span", { className: "wb-spin" })),
        cfgOpen
          ? React.createElement(ConfigPanel, { state: state, onState: setState, onClose: function () { setCfgOpen(false); } })
          : (showCard
            ? React.createElement(HoverCard, { state: state, onOpenCfg: function () { setCfgOpen(true); } })
            : null));
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    var inject = ["slots", "timer"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots) {
        slots.inject("shell.overlay", function () {
          return slots.register(
            { name: "shell.overlay", id: "whale-bubble", order: 90, label: "鲸鱼气泡" },
            function () { return React.createElement(WhaleBubble, { ctx: ctx }); }
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
