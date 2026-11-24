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
    // 注意：ps-err 已经是按钮的「失败红点」修饰类，设置页的错误段落用 ps-set-err，
    // 不要复用同一个类名承载两种语义。
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
.ps-set{display:flex;flex-direction:column;gap:14px;padding:4px 2px;color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}
.ps-set-sub{margin:0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a85)}
.ps-row{display:flex;align-items:flex-start;gap:14px}
.ps-row-l{flex:1;min-width:0}
.ps-row-n{font-size:12.5px;font-weight:600}
.ps-row-d{margin-top:2px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary,#8a8a85)}
.ps-row select{flex:none;min-width:200px;max-width:52%;font:inherit;font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer,#fff);color:var(--dsw-alias-label-primary,#1a1a1a)}
.ps-row select:disabled{opacity:.55;cursor:default}
.ps-note{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a85)}
.ps-set-err{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-state-error,#d9483b)}
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
    // 唯一的 JSON 通道：解析 + 校验 ok，失败时把宿主给的中文错误原样带出。
    // 生成、设置、模型目录三条路由共用它，避免同一段解析逻辑写三遍。
    function requestJson(url, init) {
      return fetch(url, init).then(function (res) {
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
      });
    }
    function apiGenerate(payload) {
      return requestJson("/plugins/prompt-suggest/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
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
          // 档位一律交给 host 决定（设置 > 会话），client 不再单边过滤：
          // 两处都过滤会让「设为关闭却仍在思考」这类问题无处可查。
          reasoningEffort: currentRoute ? currentRoute.reasoningEffort : undefined,
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

    // ── 设置页（settings.section）────────────────────────────────────────────
    // 两个下拉：用哪个模型、用哪个思考强度。留空 = 跟随会话 / 模型默认。
    // 思考档位由模型自己公布（DeepSeek 是 off/low/high/max），不给没有推理能力
    // 的模型显示这一项，避免选出会被 prepareCall 拒绝的值。
    var SETTINGS_ROUTE = "/plugins/prompt-suggest/settings";
    var MODELS_ROUTE = "/plugins/prompt-suggest/models";

    // 宿主公布的是 Off / Low / High / Max 这类英文名。界面其余文案都是中文，
    // 直接透传会中英混排，所以这里做一层显示名映射；未知档位才回落原名。
    var EFFORT_LABELS = { off: "关闭", low: "低", medium: "中", high: "高", max: "最高" };
    function effortLabel(effort) {
      var known = EFFORT_LABELS[effort.id];
      return typeof known === "string" ? known : (effort.name || effort.id);
    }

    function SettingsSection() {
      var settingsHook = React.useState(null);
      var settings = settingsHook[0];
      var setSettings = settingsHook[1];
      var modelsHook = React.useState(null);
      var models = modelsHook[0];
      var setModels = modelsHook[1];
      var errorHook = React.useState(null);
      var error = errorHook[0];
      var setError = errorHook[1];
      var savingHook = React.useState(false);
      var saving = savingHook[0];
      var setSaving = savingHook[1];

      React.useEffect(function () {
        var alive = true;
        requestJson(SETTINGS_ROUTE, { credentials: "same-origin" })
          .then(function (body) { if (alive) setSettings(body.settings); })
          .catch(function (e) { if (alive) setError(e.message); });
        requestJson(MODELS_ROUTE, { credentials: "same-origin" })
          .then(function (body) { if (alive) setModels(body.groups || []); })
          .catch(function (e) { if (alive) setModels([]); });
        return function () { alive = false; };
      }, []);

      var save = function (patch) {
        setSaving(true);
        setError(null);
        requestJson(SETTINGS_ROUTE, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        })
          .then(function (body) { setSettings(body.settings); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setSaving(false); });
      };

      if (!settings) {
        return React.createElement("div", { className: "ps-set" },
          React.createElement("p", { className: "ps-set-sub" }, error || "正在读取设置…"));
      }

      // 选中模型公布的档位。选「跟随当前会话」时没有具体模型，退化成所有渠道档位的并集：
      // 否则这一项只剩「模型默认」，用户在想跟随会话时根本选不了档位。
      // 并集只决定「列哪些选项」，真正是否支持由 host 侧按实际模型再过滤一次。
      var selected = null;
      if (models) {
        for (var g = 0; g < models.length; g += 1) {
          var group = models[g];
          if (group.id !== settings.provider) continue;
          for (var m = 0; m < group.models.length; m += 1) {
            if (group.models[m].id === settings.model) { selected = group.models[m]; break; }
          }
        }
      }
      var efforts = null;
      if (selected) {
        efforts = selected.efforts;
      } else if (models) {
        var union = {};
        for (var ug = 0; ug < models.length; ug += 1) {
          var ugModels = models[ug].models || [];
          for (var um = 0; um < ugModels.length; um += 1) {
            var umEfforts = ugModels[um].efforts || [];
            for (var ue = 0; ue < umEfforts.length; ue += 1) {
              if (!Object.prototype.hasOwnProperty.call(union, umEfforts[ue].id)) union[umEfforts[ue].id] = umEfforts[ue];
            }
          }
        }
        efforts = Object.keys(union).map(function (id) { return union[id]; });
      }
      var effortHidden = Array.isArray(efforts) && efforts.length === 0;
      // 存着的档位可能来自另一个模型（换了模型后常见），或模型改版后下线。
      // 不补一条 option 的话，select 的 value 匹配不到任何 option，浏览器会显示
      // 第一项「模型默认」——界面看起来是默认，磁盘里却还是旧值，属于静默不一致。
      var effortKnown = efforts === null
        || efforts.some(function (effort) { return effort.id === settings.reasoningEffort; });
      var effortStale = !effortKnown && settings.reasoningEffort !== "";

      var modelValue = settings.provider && settings.model
        ? settings.provider + "\u0000" + settings.model
        : "";
      // 已保存的模型可能来自已卸载的渠道，或已经从目录里下线。
      // 不补一条 option，浏览器会回落到首项「跟随当前会话」——界面说跟随，磁盘里却还是旧模型。
      var modelKnown = models === null || modelValue === "" || (models || []).some(function (group) {
        return group.id === settings.provider && (group.models || []).some(function (model) {
          return model.id === settings.model;
        });
      });
      var modelStale = !modelKnown && modelValue !== "";

      return React.createElement("div", { className: "ps-set" },
        React.createElement("p", { className: "ps-set-sub" },
          "这里设置的是提示词建议按钮自己用的模型与思考强度，只影响这个按钮，不影响正常对话。"),
        React.createElement("div", { className: "ps-row" },
          React.createElement("div", { className: "ps-row-l" },
            React.createElement("div", { className: "ps-row-n" }, "用哪个模型"),
            React.createElement("div", { className: "ps-row-d" }, "留空则跟随当前会话正在用的模型。")),
          React.createElement("select", {
            value: modelValue,
            disabled: saving || !models,
            "aria-label": "用哪个模型",
            onChange: function (event) {
              var raw = event.target.value;
              if (raw === "") { save({ provider: "", model: "" }); return; }
              var split = raw.indexOf("\u0000");
              save({ provider: raw.slice(0, split), model: raw.slice(split + 1) });
            },
          },
            React.createElement("option", { value: "" }, "跟随当前会话"),
            modelStale
              ? React.createElement("option", { value: modelValue },
                  settings.model + "（已不可用）")
              : null,
            (models || []).map(function (group) {
              return React.createElement("optgroup", { key: group.id, label: group.name },
                group.models.map(function (model) {
                  return React.createElement("option", {
                    key: group.id + "\u0000" + model.id,
                    value: group.id + "\u0000" + model.id,
                  }, model.name);
                }));
            }))),
        React.createElement("div", { className: "ps-row" },
          React.createElement("div", { className: "ps-row-l" },
            React.createElement("div", { className: "ps-row-n" }, "思考强度"),
            React.createElement("div", { className: "ps-row-d" },
              effortHidden
                ? "所选模型不支持调节思考强度，这一项不生效。"
                : effortStale
                  ? "已保存的档位不在该模型公布的列表内，实际会按模型默认执行。选一个档位即可修正。"
                  : "润色时使用。选到最低档可以更快、更省 token；生成建议始终不启用思考。")),
          React.createElement("select", {
            value: settings.reasoningEffort,
            disabled: saving || effortHidden,
            "aria-label": "思考强度",
            onChange: function (event) { save({ reasoningEffort: event.target.value }); },
          },
            React.createElement("option", { value: "" }, "模型默认"),
            effortStale
              ? React.createElement("option", { value: settings.reasoningEffort },
                  settings.reasoningEffort + "（模型不支持）")
              : null,
            (efforts || []).map(function (effort) {
              return React.createElement("option", { key: effort.id, value: effort.id }, effortLabel(effort));
            }))),
        error !== null ? React.createElement("p", { className: "ps-set-err" }, error) : null,
        React.createElement("p", { className: "ps-note" },
          "保存后立即生效，无需重启。"));
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
      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "prompt-suggest", order: 55, label: "提示词建议" },
          function () { return React.createElement(SettingsSection, null); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
