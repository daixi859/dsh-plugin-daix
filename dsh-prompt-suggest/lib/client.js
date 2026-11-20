// dsh-prompt-suggest — client 面
//
// 挂点：
//   conversation.input.right — 工具行紧凑图标按钮（会话作用域，standard props 携带
//     sessionId / useInput / useProjection / inputActions，与内置 quote 同一条公共 face）。
//   shell.overlay — 润色编辑卡片（frame 顶层 list 槽，fixed 定位无需 portal）。
// 数据通道：fetch POST /plugins/prompt-suggest/generate
//   { sessionId, draft, provider, model, reasoningEffort? } → { ok, text } | { ok, error }
// 行为：
//   草稿为空 → 生成建议，直接 setDraft 填充；
//   草稿非空 → 润色，弹编辑卡片（Ctrl+Enter 保存替换，Esc/取消丢弃）。
// 按钮与卡片同 factory 闭包共享一个小状态仓（会话切换时按钮重挂刷新 inputActions）。

window.__ModuleLoader__.load({
  id: "dsh-prompt-suggest",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    var BUTTON_ID = "prompt-suggest-trigger";
    var EDITOR_ID = "prompt-suggest-editor";

    // ── 样式 ────────────────────────────────────────────────────────────────
    var css = `
.ps-btn{flex:none;width:28px;height:28px;border:none;background:transparent;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--dsw-alias-label-secondary,#8a8a85);position:relative;padding:0;transition:color .15s,background .15s}
.ps-btn:hover{color:var(--dsw-alias-brand-primary,#4a7dff);background:var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.ps-btn:disabled{opacity:.45;cursor:default}
.ps-btn svg{width:15px;height:15px;display:block}
.ps-btn.ps-err::after{content:"";position:absolute;top:1px;right:1px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error,#d9483b);border:1px solid var(--dsw-alias-bg-layer,#fff)}
@keyframes ps-rot{to{transform:rotate(360deg)}}
.ps-spin-icon{animation:ps-rot .8s linear infinite}
.ps-overlay{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.32);display:flex;align-items:flex-end;justify-content:center;padding-bottom:12vh;animation:ps-fade .14s ease-out}
@keyframes ps-fade{from{opacity:0}}
.ps-card{width:min(640px,calc(100vw - 48px));border-radius:12px;background:var(--dsw-alias-bg-layer,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 12px 40px rgba(0,0,0,.18);padding:14px;color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit;animation:ps-pop .16s ease-out}
@keyframes ps-pop{from{opacity:0;transform:translateY(10px)}}
.ps-card h3{margin:0 0 8px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.ps-card h3 span.ps-badge{font-size:10.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#8a8a85);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:5px;padding:1px 6px}
.ps-card textarea{width:100%;box-sizing:border-box;min-height:110px;max-height:40vh;resize:vertical;font:inherit;font-size:12.5px;line-height:1.55;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-layer,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);outline:none}
.ps-card textarea:focus{border-color:var(--dsw-alias-brand-primary,#4a7dff)}
.ps-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:10px}
.ps-hint{margin-right:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary,#8a8a85)}
.ps-btn2{font:inherit;font-size:12px;padding:5px 14px;border-radius:7px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a)}
.ps-btn2:hover{background:var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.ps-btn2.ps-primary{background:var(--dsw-alias-brand-primary,#4a7dff);border-color:transparent;color:#fff}
.ps-btn2.ps-primary:hover{filter:brightness(1.06)}
.ps-btn2:disabled{opacity:.55;cursor:default}
`;
    var tagId = "dsh-prompt-suggest/prompt-suggest.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-prompt-suggest";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 按钮与卡片之间的小状态仓 ────────────────────────────────────────────
    // sessionId 记录卡片归属会话；会话切换时按钮重挂会把不匹配的卡片关掉，
    // 避免"在会话 A 弹卡片、保存却写进会话 B 的输入框"。
    var editorStore = { open: false, text: "", saving: false, actions: null, sessionId: null };
    var editorListeners = [];
    function notifyEditor() {
      var snapshot = { open: editorStore.open, text: editorStore.text, saving: editorStore.saving };
      for (var i = 0; i < editorListeners.length; i++) {
        // 单个订阅者 setState 抛错不能阻断其余订阅者收到通知
        try { editorListeners[i](snapshot); } catch (e) {}
      }
    }
    function subscribeEditor(fn) {
      editorListeners.push(fn);
      return function () {
        var idx = editorListeners.indexOf(fn);
        if (idx >= 0) editorListeners.splice(idx, 1);
      };
    }
    function openEditor(text, actions, sessionId) {
      editorStore.open = true;
      editorStore.text = text;
      editorStore.saving = false;
      editorStore.actions = actions || editorStore.actions;
      editorStore.sessionId = sessionId || editorStore.sessionId;
      notifyEditor();
    }
    function closeEditor() {
      editorStore.open = false;
      editorStore.text = "";
      editorStore.saving = false;
      notifyEditor();
    }

    // ── 数据通道 ────────────────────────────────────────────────────────────
    function unwrap(res) {
      return res.text().then(function (bodyText) {
        var j;
        try { j = JSON.parse(bodyText); } catch (e) {
          throw new Error("服务响应不是 JSON（HTTP " + res.status + "）");
        }
        if (!res.ok || !j || j.ok !== true) {
          throw new Error((j && j.error) || ("请求失败（HTTP " + res.status + "）"));
        }
        return j;
      });
    }
    function apiGenerate(payload) {
      return fetch("/plugins/prompt-suggest/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(unwrap);
    }

    // ── 图标 ────────────────────────────────────────────────────────────────
    function SparkIcon() {
      return React.createElement("svg", {
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
      },
        React.createElement("path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" }),
        React.createElement("path", { d: "M19 15l.9 2.4L22 18.3l-2.1.9L19 21.5l-.9-2.3-2.1-.9 2.1-.9L19 15z" }));
    }

    function SpinIcon() {
      return React.createElement("svg", {
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: "2.2", strokeLinecap: "round", className: "ps-spin-icon", "aria-hidden": true,
      },
        React.createElement("path", { d: "M12 3a9 9 0 1 0 9 9" }));
    }

    // ── 工具行按钮（conversation.input.right）───────────────────────────────
    // 模型路由读法（对齐 DSH 内置 model-selection）：useProjection('modelSelection')
    // 返回 { lastUsed, next }（可能 undefined = 能力未就绪）；当前生效 = next ?? lastUsed。
    // hook 只能在渲染期调用；事件回调里使用渲染期捕获的值。
    function TriggerButton(props) {
      var sessionId = props.sessionId;
      var inputActions = props.inputActions;
      var useInput = props.useInput;
      var useProjection = props.useProjection;

      var inputState = typeof useInput === "function" ? useInput(function (s) { return s; }) : null;
      var draft = inputState && typeof inputState.draft === "string" ? inputState.draft : "";
      var phase = inputState ? inputState.phase : "plain";

      var projection = typeof useProjection === "function" ? useProjection("modelSelection") : null;
      // useProjection('modelSelection') 的返回形状是 ModelSelectionProjection
      // = { lastUsed: ModelSelection|null, next: ModelSelection|null };当前生效 = next ?? lastUsed。
      // 空会话(尚无任何请求)时两者都可能是 null/undefined → 按钮报"无法确定当前会话的模型"。
      var currentRoute = projection && (projection.next || projection.lastUsed) || null;
      var polish = draft.trim() !== "";

      var busyHook = React.useState(false);
      var busy = busyHook[0];
      var setBusy = busyHook[1];
      var errorHook = React.useState(null);
      var error = errorHook[0];
      var setError = errorHook[1];

      React.useEffect(function () {
        // 会话切换/重挂：刷新卡片的目标会话与 inputActions；
        // 若编辑卡片属于别的会话，直接关掉，避免把润色结果写进错误会话的输入框。
        editorStore.actions = inputActions || null;
        if (editorStore.open && editorStore.sessionId !== null && editorStore.sessionId !== sessionId) {
          closeEditor();
        }
      }, [sessionId, inputActions]);

      var requestGenerate = function () {
        if (!sessionId) return;
        // 模型路由：投影有值用投影；空会话投影为 null 时不拦截，交给 host 按全局默认回落。
        setError(null);
        setBusy(true);
        apiGenerate({
          sessionId: sessionId,
          draft: draft,
          provider: currentRoute ? currentRoute.provider : '',
          model: currentRoute ? currentRoute.model : '',
          // 建议模式不透传推理档位：推理 token 会吃掉较小的输出上限
          reasoningEffort: polish && currentRoute ? currentRoute.reasoningEffort : undefined,
        })
          .then(function (r) {
            if (typeof r.text !== "string" || r.text.length === 0) throw new Error("返回内容为空");
            if (!polish) {
              // 空草稿：建议模式，直接填充输入框
              if (typeof inputActions === "object" && inputActions !== null && typeof inputActions.setDraft === "function") {
                var accepted = inputActions.setDraft(r.text);
                if (accepted === false) throw new Error("输入框当前状态不接受填充（稍后再试）");
              } else {
                throw new Error("输入框接口不可用");
              }
            } else {
              // 有草稿：润色模式，先弹编辑卡片，保存才替换
              openEditor(r.text, inputActions, sessionId);
            }
          })
          .catch(function (e) {
            setError(e && e.message ? e.message : String(e));
          })
          .then(function () { setBusy(false); });
      };

      var title = error
        ? ("提示词建议失败：" + error)
        : (polish ? "润色当前草稿" : "生成提示词建议");

      return React.createElement("button", {
        type: "button",
        id: BUTTON_ID,
        className: "ps-btn" + (error ? " ps-err" : ""),
        title: title,
        "aria-label": title,
        disabled: busy || phase !== "plain" || !sessionId,
        onClick: requestGenerate,
      },
        busy ? React.createElement(SpinIcon, null) : React.createElement(SparkIcon, null));
    }

    // ── 润色编辑卡片（shell.overlay）────────────────────────────────────────
    function EditCard() {
      var stateHook = React.useState(function () {
        return { open: editorStore.open, text: editorStore.text, saving: editorStore.saving };
      });
      var state = stateHook[0];
      var setState = stateHook[1];

      React.useEffect(function () {
        return subscribeEditor(function (snapshot) {
          setState({ open: snapshot.open, text: snapshot.text, saving: snapshot.saving });
        });
      }, []);

      var draftRef = React.useRef(null);

      React.useEffect(function () {
        if (state.open && draftRef.current) {
          draftRef.current.value = state.text;
          var el = draftRef.current;
          var focusTimer = setTimeout(function () {
            el.focus();
            // 非 input/textarea 或不可见态会抛：光标定位失败不影响聚焦本身
            try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
          }, 30);
          return function () { clearTimeout(focusTimer); };
        }
        return undefined;
      }, [state.open, state.text]);

      if (!state.open) return null;

      var commit = function () {
        var value = draftRef.current ? draftRef.current.value : "";
        if (value.trim().length === 0) return;
        var actions = editorStore.actions;
        if (!actions || typeof actions.setDraft !== "function") { closeEditor(); return; }
        var accepted = actions.setDraft(value);
        if (accepted === false) return; // 保留卡片，让用户再试或取消
        closeEditor();
      };

      return React.createElement("div", {
        className: "ps-overlay",
        onClick: function () { closeEditor(); },
        onKeyDown: function (e) {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEditor(); }
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            e.preventDefault(); commit();
          }
        },
      },
        React.createElement("div", {
          className: "ps-card", role: "dialog", "aria-modal": "true", "aria-label": "润色结果",
          onClick: function (e) { e.stopPropagation(); },
        },
          React.createElement("h3", null, "润色结果 ",
            React.createElement("span", { className: "ps-badge" }, "Ctrl+Enter 保存 · Esc 取消")),
          React.createElement("textarea", {
            ref: draftRef, defaultValue: state.text, spellCheck: false,
          }),
          React.createElement("div", { className: "ps-actions" },
            React.createElement("span", { className: "ps-hint" }, "保存后替换输入框内容；取消不改动"),
            React.createElement("button", {
              type: "button", className: "ps-btn2",
              onClick: function () { closeEditor(); },
            }, "取消"),
            React.createElement("button", {
              type: "button", className: "ps-btn2 ps-primary",
              onClick: commit,
            }, "替换草稿"))));
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    var inject = ["slots"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (!slots) return;
      slots.inject("conversation.input.right", function () {
        return slots.register(
          { name: "conversation.input.right", id: BUTTON_ID, order: 10, label: "提示词建议" },
          function (props) { return React.createElement(TriggerButton, props); }
        );
      });
      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: EDITOR_ID, order: 95, label: "润色编辑卡片" },
          function () { return React.createElement(EditCard, null); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
