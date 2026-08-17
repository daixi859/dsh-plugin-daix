// dsh-skill-manager — client 面
//
// 官方 client bundle 协议：window.__ModuleLoader__.load({ id, factory })，
// factory 接收 require，返回 { apply, inject }（CJS 形态）。
// 数据通道：fetch 调 host 面注册的 webServer HTTP 路由
//   GET  /plugins/skill-manager/list?cwd=...
//   POST /plugins/skill-manager/set-enabled

window.__ModuleLoader__.load({
  id: "dsh-skill-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let React = require("react");

    // ── 样式注入（官方 ui-skill 同款原生 DOM 模式）────────────────────────
    var css = `
.skm-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.skm-head{justify-content:space-between;align-items:center;gap:8px;display:flex}
.skm-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.skm-refresh{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:14px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}
.skm-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.skm-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.skm-note{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}
.skm-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}
.skm-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.skm-groups{flex-direction:column;gap:16px;display:flex}
.skm-group{flex-direction:column;gap:8px;display:flex}
.skm-group-title{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:12px;font-weight:500;line-height:18px;display:flex}
.skm-group-count{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;line-height:16px}
.skm-list{flex-direction:column;gap:6px;display:flex}
.skm-row{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;align-items:center;gap:10px;padding:8px 10px 8px 12px;display:flex}
.skm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.skm-row-main{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}
.skm-row-name{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:14px;font-weight:500;line-height:22px;display:flex}
.skm-badge{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;padding:0 5px;font-size:11px;font-weight:400;line-height:16px}
.skm-row[data-enabled="true"] .skm-badge{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}
.skm-row-desc{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden}
.skm-row-path{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow:hidden}
.skm-switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-module-platform);cursor:pointer;border-radius:10px;flex:none;padding:0;position:relative;transition:background .12s,border-color .12s}
.skm-switch:hover{background:var(--dsw-alias-interactive-bg-hover)}
.skm-switch[data-on="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill)}
.skm-thumb{background:var(--dsw-alias-label-tertiary);width:16px;height:16px;border-radius:8px;position:absolute;top:1px;left:1px;transition:left .12s,background .12s}
.skm-switch[data-on="true"] .skm-thumb{background:var(--dsw-alias-label-primary-foreground);left:17px}
.skm-lock{flex:none;font-size:13px;line-height:20px}
`;
    var tagId = "dsh-skill-manager/SkillManager.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-skill-manager";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ────────────────────────────────────────────────────────────────
    var NS = "skill-manager-ui";
    var zh = {
      nav: "技能管理",
      title: "技能管理",
      intro: "管理全局与项目中的技能。禁用后技能将从模型目录和 / 手势中消失，但文件本身保留，可随时重新启用。",
      global: "全局技能",
      project: "项目技能",
      builtin: "内置技能（只读）",
      empty: "暂无技能",
      error: "加载失败",
      refresh: "刷新",
      enabled: "已启用",
      disabled: "已禁用",
      modelOnly: "仅模型",
      userOnly: "仅用户",
      noWorkspace: "未检测到工作区（项目技能可能不可用）",
      loading: "加载中…",
      toggleFailed: "切换失败",
    };
    var en = {
      nav: "Skills",
      title: "Skill Manager",
      intro: "Manage global and project skills. Disabled skills disappear from the model catalog and / gestures, but their files remain and can be re-enabled anytime.",
      global: "Global skills",
      project: "Project skills",
      builtin: "Built-in skills (read-only)",
      empty: "No skills",
      error: "Failed to load",
      refresh: "Refresh",
      enabled: "Enabled",
      disabled: "Disabled",
      modelOnly: "model-only",
      userOnly: "user-only",
      noWorkspace: "No workspace detected (project skills may be unavailable)",
      loading: "Loading…",
      toggleFailed: "Toggle failed",
    };

    // ── 数据访问 ────────────────────────────────────────────────────────────
    function fetchList(workspacePath) {
      var query = workspacePath ? "?cwd=" + encodeURIComponent(workspacePath) : "";
      return fetch("/plugins/skill-manager/list" + query, { cache: "no-store" })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload && payload.ok) return payload;
          throw new Error((payload && payload.error) || "list failed");
        });
    }

    function fetchSetEnabled(path, enabled) {
      return fetch("/plugins/skill-manager/set-enabled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: path, enabled: enabled }),
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload && payload.ok) return payload;
          throw new Error((payload && payload.error) || "set-enabled failed");
        });
    }

    // ── 设置页组件 ──────────────────────────────────────────────────────────
    function SkillManagerView(props) {
      var useWorkspaces = props.useWorkspaces;
      var workspacePath = useWorkspaces(function (s) {
        var items = s.items || [];
        var recent = items.find(function (w) { return w.id === s.recentWorkspaceId; });
        return recent ? recent.path : undefined;
      });
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;
      var t = props.t;
      var loadingState = useState(true);
      var loading = loadingState[0];
      var setLoading = loadingState[1];
      var errorState = useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var groupsState = useState(null);
      var groups = groupsState[0];
      var setGroups = groupsState[1];

      var load = useCallback(function () {
        setLoading(true);
        fetchList(workspacePath).then(function (payload) {
          setLoading(false);
          setGroups(payload.groups);
          setError(null);
        }, function (err) {
          setLoading(false);
          setError(String((err && err.message) || err));
        });
      }, [workspacePath]);

      useEffect(function () { load(); }, [load]);

      function setItemEnabled(path, enabled) {
        setGroups(function (prev) {
          if (!prev) return prev;
          var next = {};
          Object.keys(prev).forEach(function (key) {
            next[key] = prev[key].map(function (item) {
              return item.path === path
                ? Object.assign({}, item, { enabled: enabled, modelInvocable: enabled, userInvocable: enabled })
                : item;
            });
          });
          return next;
        });
      }

      function toggle(item) {
        var nextEnabled = !item.enabled;
        if (!item.path) {
          setError(t("toggleFailed") + ": skill path unavailable");
          return;
        }
        setItemEnabled(item.path, nextEnabled);
        fetchSetEnabled(item.path, nextEnabled).then(function () {
          // 成功：乐观状态保留
        }, function (err) {
          setItemEnabled(item.path, item.enabled);
          setError(t("toggleFailed") + ": " + String((err && err.message) || err));
        });
      }

      function renderRow(item, editable) {
        var badge = !item.enabled
          ? t("disabled")
          : item.modelInvocable && item.userInvocable
            ? t("enabled")
            : item.modelInvocable
              ? t("userOnly")
              : t("modelOnly");
        return React.createElement(
          "div",
          { key: item.path, className: "skm-row", "data-enabled": item.enabled ? "true" : "false" },
          React.createElement(
            "div",
            { className: "skm-row-main" },
            React.createElement(
              "div",
              { className: "skm-row-name" },
              item.name,
              React.createElement("span", { className: "skm-badge" }, badge)
            ),
            React.createElement("div", { className: "skm-row-desc", title: item.description }, item.description),
            item.path ? React.createElement("div", { className: "skm-row-path", title: item.path }, item.path) : null
          ),
          editable
            ? React.createElement(
                "button",
                {
                  type: "button",
                  role: "switch",
                  "aria-checked": item.enabled ? "true" : "false",
                  "aria-label": item.name,
                  className: "skm-switch",
                  "data-on": item.enabled ? "true" : "false",
                  onClick: function () { toggle(item); },
                },
                React.createElement("span", { className: "skm-thumb" })
              )
            : React.createElement("span", { className: "skm-lock" }, "\uD83D\uDD12")
        );
      }

      function renderGroup(title, items, editable) {
        return React.createElement(
          "section",
          { key: title, className: "skm-group" },
          React.createElement(
            "h3",
            { className: "skm-group-title" },
            title,
            React.createElement("span", { className: "skm-group-count" }, String(items.length))
          ),
          items.length === 0
            ? React.createElement("p", { className: "skm-empty" }, t("empty"))
            : React.createElement(
                "div",
                { className: "skm-list" },
                items.map(function (item) { return renderRow(item, editable); })
              )
        );
      }

      var title = React.createElement(
        "div",
        { className: "skm-head" },
        React.createElement("h2", { className: "skm-title" }, t("title")),
        React.createElement("button", { type: "button", className: "skm-refresh", onClick: load }, t("refresh"))
      );

      var body;
      if (loading) {
        body = React.createElement("p", { className: "skm-empty" }, t("loading"));
      } else if (error) {
        body = React.createElement(
          "div",
          { className: "skm-groups" },
          React.createElement("p", { className: "skm-error" }, t("error"), ": ", error),
          groups
            ? React.createElement(
                React.Fragment,
                null,
                renderGroup(t("global"), groups.global || [], true),
                renderGroup(t("project"), groups.project || [], true),
                renderGroup(t("builtin"), groups.builtin || [], false)
              )
            : null
        );
      } else {
        body = React.createElement(
          React.Fragment,
          null,
          React.createElement("p", { className: "skm-intro" }, t("intro")),
          !workspacePath ? React.createElement("p", { className: "skm-note" }, t("noWorkspace")) : null,
          groups
            ? React.createElement(
                "div",
                { className: "skm-groups" },
                renderGroup(t("global"), groups.global || [], true),
                renderGroup(t("project"), groups.project || [], true),
                renderGroup(t("builtin"), groups.builtin || [], false)
              )
            : null
        );
      }

      return React.createElement("div", { className: "skm-section" }, title, body);
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    var inject = ["slots", "locale"];

    function apply(ctx) {
      var locale = ctx.get("locale");
      var t = function (key) { return key; };
      if (locale) {
        ctx.effect(
          function () {
            return locale.register(NS, { zh: zh, en: en });
          },
          "skill-manager: locales"
        );
        t = locale.bind(NS);
      }
      var slots = ctx.get("slots");
      if (slots) {
        slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "skill-manager", order: 25, label: function () { return t("nav"); } },
            SkillManagerView
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
