// dsh-mcp-gate — client 面
//
// 官方 client bundle 协议：window.__ModuleLoader__.load({ id, factory })，
// factory 接收 require，返回 { apply, inject }（CJS 形态）。
// 数据通道：fetch 调 host 面注册的 webServer HTTP 路由
//   GET  /plugins/mcp-gate/state?cwd=...   → { ok, master, servers: [...] }
//   POST /plugins/mcp-gate/master          { enabled }
//   POST /plugins/mcp-gate/global          { server, enabled?, exposure?, tool?, toolExposure? }
//   POST /plugins/mcp-gate/project         { cwd, server, enabled: true|false|null }
// 挂载：settings.section slot。样式惯例对齐 dsh-skill-manager（--dsw-alias-* token）。

window.__ModuleLoader__.load({
  id: "dsh-mcp-gate",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let React = require("react");

    // ── 样式注入 ────────────────────────────────────────────────────────────
    var css = `
.mcp-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.mcp-head{justify-content:space-between;align-items:center;gap:8px;display:flex}
.mcp-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.mcp-master{align-items:center;gap:10px;display:flex}
.mcp-master-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mcp-refresh{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:14px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}
.mcp-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcp-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.mcp-note{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}
.mcp-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}
.mcp-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.mcp-picker{align-items:center;gap:10px;display:flex;min-width:0}
.mcp-picker-label{color:var(--dsw-alias-label-secondary);flex:none;font-size:12px;line-height:18px}
.mcp-picker-select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;background:0 0;border-radius:14px;padding:0 10px;max-width:480px;min-width:0;flex:1;cursor:pointer}
.mcp-picker-select:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-picker-select:focus{outline:none;border-color:var(--dsw-alias-border-l3)}
.mcp-tabs{gap:6px;display:flex;flex-wrap:wrap}
.mcp-tab{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:26px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:13px;align-items:center;gap:5px;padding:0 10px;font-size:12px;line-height:16px;display:inline-flex}
.mcp-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-tab[data-active="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcp-tab-count{font-size:11px;opacity:.75}
.mcp-list{flex-direction:column;gap:6px;display:flex}
.mcp-row{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;align-items:center;gap:10px;padding:8px 10px 8px 12px;display:flex;flex-wrap:wrap}
.mcp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-row[data-disabled="true"]{opacity:.55}
.mcp-dot{border-radius:6px;width:10px;height:10px;flex:none;background:var(--dsw-alias-border-l3)}
.mcp-dot[data-state="on"]{background:var(--dsw-alias-state-success-primary)}
.mcp-dot[data-state="off"]{background:var(--dsw-alias-state-error-primary)}
.mcp-dot[data-state="project"]{background:var(--dsw-alias-state-warn-label)}
.mcp-row-main{flex-direction:column;gap:2px;min-width:180px;flex:1;display:flex;cursor:pointer}
.mcp-row-name{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:14px;font-weight:500;line-height:22px;display:flex}
.mcp-badge{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;padding:0 5px;font-size:11px;font-weight:400;line-height:16px}
.mcp-badge[data-live="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcp-row-desc{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden}
.mcp-row-desc .mcp-overridden{color:var(--dsw-alias-state-warn-label)}
.mcp-switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-module-platform);cursor:pointer;border-radius:10px;flex:none;padding:0;position:relative;transition:background .12s,border-color .12s}
.mcp-switch:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-switch[data-on="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill)}
.mcp-thumb{background:var(--dsw-alias-label-tertiary);width:16px;height:16px;border-radius:8px;position:absolute;top:1px;left:1px;transition:left .12s,background .12s}
.mcp-switch[data-on="true"] .mcp-thumb{background:var(--dsw-alias-label-primary-foreground);left:17px}
.mcp-tri{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;display:inline-flex;flex:none}
.mcp-tri button{border:0;height:24px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;padding:0 8px;font-size:11px;line-height:16px}
.mcp-tri button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-tri button+button{border-left:1px solid var(--dsw-alias-border-l2)}
.mcp-tri button[data-on="true"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcp-tri[data-override="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 55%,transparent)}
.mcp-count{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;flex:none;min-width:44px;text-align:right}
.mcp-tools{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:4px;width:100%;padding:8px 2px 2px;display:flex}
.mcp-tools-title{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:16px}
.mcp-tool-row{align-items:center;gap:8px;display:flex}
.mcp-tool-name{color:var(--dsw-alias-label-primary);cursor:pointer;font-family:var(--ds-font-family-code);font-size:11px;line-height:18px}
.mcp-tool-name:hover{text-decoration:underline}
.mcp-tool-desc{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;flex:1;overflow:hidden}
.mcp-seg{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;display:inline-flex;margin-left:auto;flex:none}
.mcp-seg button{border:0;height:20px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;padding:0 7px;font-size:10px;line-height:14px}
.mcp-seg button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-seg button+button{border-left:1px solid var(--dsw-alias-border-l2)}
.mcp-seg button[data-on="true"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcp-seg[data-override="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 55%,transparent)}
.mcp-row-actions{display:inline-flex;gap:2px;flex:none}
.mcp-icon-btn{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;min-width:24px;height:24px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px;white-space:nowrap}
.mcp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mcp-icon-btn[data-danger="true"]:hover{color:var(--dsw-alias-state-error-primary)}
.mcp-icon-btn[data-confirm="true"]{color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.mcp-add-btn{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:14px;align-items:center;gap:5px;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}
.mcp-add-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-note-bar{align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px;display:flex}
.mcp-note-bar[data-kind="warn"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 45%,transparent);color:var(--dsw-alias-state-warn-label)}
.mcp-note-bar[data-kind="ok"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcp-note-close{margin-left:auto;border:0;background:0 0;color:inherit;cursor:pointer;font:inherit;font-size:13px;padding:0 2px;flex:none}
.mcp-modal-mask{position:fixed;inset:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent);z-index:1000;align-items:center;justify-content:center;display:flex}
.mcp-modal{box-sizing:border-box;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;max-width:560px;width:calc(100vw - 48px);max-height:calc(100vh - 96px);overflow:auto;padding:16px;flex-direction:column;gap:10px;display:flex}
.mcp-modal-title{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:20px}
.mcp-templates{gap:6px;display:flex;flex-wrap:wrap}
.mcp-template-chip{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:24px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:12px;padding:0 10px;font-size:11px;line-height:16px;display:inline-flex;align-items:center}
.mcp-template-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mcp-field{flex-direction:column;gap:4px;display:flex}
.mcp-field-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mcp-input,.mcp-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:6px 8px;width:100%}
.mcp-textarea{min-height:52px;resize:vertical;font-family:var(--ds-font-family-code)}
.mcp-input:focus,.mcp-textarea:focus{outline:none;border-color:var(--dsw-alias-border-l3)}
.mcp-kv{gap:6px;align-items:center;display:flex}
.mcp-kv .mcp-input{flex:1;min-width:0}
.mcp-kv-key{flex:0 0 38%}
.mcp-kv-del{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;padding:0 4px;flex:none}
.mcp-kv-del:hover{color:var(--dsw-alias-state-error-primary)}
.mcp-hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.mcp-hint[data-warn="true"]{color:var(--dsw-alias-state-warn-label)}
.mcp-hint[data-ok="true"]{color:var(--dsw-alias-state-success-primary)}
.mcp-modal-actions{gap:8px;justify-content:flex-end;margin-top:4px;display:flex}
.mcp-btn{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;padding:6px 14px;font-size:12px;line-height:18px}
.mcp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcp-btn-primary:hover{background:var(--dsw-alias-button-primary-fill);opacity:.9}
`;
    var tagId = "dsh-mcp-gate/McpGate.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-mcp-gate";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ────────────────────────────────────────────────────────────────
    var NS = "mcp-gate-ui";
    var zh = {
      nav: "MCP 服务器",
      title: "MCP 服务器",
      intro: "渐进式披露：工具默认折叠，模型用 mcp_search 按需检索解锁；命中后下一轮可用。全局设置默认行为，项目可对单个服务器覆盖开启或关闭。",
      master: "整体启用",
      masterOffNote: "总开关已关闭：所有项目中 MCP 均不可用。",
      workspace: "工作区",
      noWorkspace: "未检测到工作区（项目覆盖不可用）",
      refresh: "刷新",
      loading: "加载中…",
      error: "加载失败",
      empty: "没有接入的 MCP 服务器",
      tabAll: "全部",
      tabEnabled: "已启用",
      tabDisabled: "已禁用",
      tabOverride: "本项目覆盖",
      tools: "工具",
      inherit: "继承",
      projectOn: "项目开",
      projectOff: "项目关",
      projectDisabled: "本项目已禁用（全局开启）",
      projectEnabledOnly: "仅本项目启用（全局关闭）",
      exposureLabel: "披露",
      direct: "全量",
      deferred: "折叠",
      hidden: "隐藏",
      globalSwitch: "全局",
      expandHint: "查看工具",
      toolReset: "点击恢复继承（取消 per-tool 覆盖）",
      tabForm: "手动填写",
      tabJson: "粘贴 JSON 导入",
      importSubmit: "导入",
      importPlaceholder: '{\n  "mcpServers": {\n    "my-server": {\n      "command": "node",\n      "args": ["/path/to/server.mjs"],\n      "description": "一句话说明这个服务器的用途"\n    }\n  }\n}',
      importHint: "兼容 Claude Code / Cursor 的 mcpServers 格式：command+args 为 stdio，url+headers 为 HTTP；可一次导入多个，重名自动跳过。",
      errJsonEmpty: "请先粘贴 JSON",
      errJsonParse: "JSON 格式错误",
      importDone: "已导入",
      importSkipped: "跳过",
      importFailed: "失败",
      importNothing: "没有可导入的服务器",
      failed: "操作失败",
      addServer: "添加服务器",
      editServer: "编辑接入",
      deleteServer: "删除",
      deleteConfirm: "确认删除？",
      transport: "传输方式",
      transportStdio: "本地进程 (stdio)",
      transportHttp: "远程 HTTP (streamable-http)",
      command: "命令",
      args: "参数（每行一个）",
      env: "环境变量",
      url: "URL",
      headers: "HTTP 头",
      cwd: "工作目录（可选）",
      addRow: "+ 添加一行",
      save: "保存",
      cancel: "取消",
      templates: "模板",
      name: "服务器名称",
      desc: "一句话描述",
      descPlaceholder: "让模型知道何时用它，如：仓库 / issue / PR 操作（可选，会写入系统提示目录）",
      nameRequired: "保存后立即连接，无需重启",
      liveNote: "已连接，立即生效",
      liveFailed: "连接失败：",
      removedLiveNote: "已断开并移除，立即生效",
      managedBadge: "即时",
      connConnected: "已连接",
      connError: "连接失败",
      connMissing: "未配置连接 · 点 ✎ 补全后立即连接",
      connDisconnected: "未连接",
      plaintextPatch: "疑似明文密钥：将直接写入配置文件，建议改用 ${ENV_VAR} 引用",
      envRefHint: "检测到 ${VAR} 引用：密钥不明文落盘，进程环境注入",
      plaintextWarn: "疑似明文密钥：将直接写入配置文件，建议改用 ${ENV_VAR} 引用",
      errName: "名称只能包含字母、数字、下划线和连字符（1-32 字符）",
      errExists: "该名称已被占用",
      errUrl: "URL 必须以 http:// 或 https:// 开头",
      errCommand: "stdio 服务器必须填写命令",
      noEdit: "此服务器由 bundle 层定义，请在对应 bundle 中修改",
    };
    var en = {
      nav: "MCP Servers",
      title: "MCP Servers",
      intro: "Progressive disclosure: tools start folded; the model unlocks them on demand via mcp_search, and matches become available next turn. Global settings are defaults; each project can override servers on or off individually.",
      master: "Enable MCP",
      masterOffNote: "Master switch is off: MCP is unavailable in every project.",
      workspace: "Workspace",
      noWorkspace: "No workspace detected (project overrides unavailable)",
      refresh: "Refresh",
      loading: "Loading…",
      error: "Failed to load",
      empty: "No MCP servers connected",
      tabAll: "All",
      tabEnabled: "Enabled",
      tabDisabled: "Disabled",
      tabOverride: "Project overrides",
      tools: "tools",
      inherit: "Inherit",
      projectOn: "On here",
      projectOff: "Off here",
      projectDisabled: "Disabled in this project (global on)",
      projectEnabledOnly: "Enabled only in this project (global off)",
      exposureLabel: "Disclosure",
      direct: "Direct",
      deferred: "Deferred",
      hidden: "Hidden",
      globalSwitch: "Global",
      expandHint: "View tools",
      toolReset: "Click to inherit again (clear per-tool override)",
      tabForm: "Manual",
      tabJson: "Import JSON",
      importSubmit: "Import",
      importPlaceholder: '{\n  "mcpServers": {\n    "my-server": {\n      "command": "node",\n      "args": ["/path/to/server.mjs"],\n      "description": "One-line description of what this server is for"\n    }\n  }\n}',
      importHint: "Accepts the Claude Code / Cursor mcpServers format: command+args = stdio, url+headers = HTTP. Multiple servers allowed; duplicates are skipped.",
      errJsonEmpty: "Paste JSON first",
      errJsonParse: "Invalid JSON",
      importDone: "Imported",
      importSkipped: "Skipped",
      importFailed: "Failed",
      importNothing: "Nothing to import",
      failed: "Operation failed",
      addServer: "Add server",
      editServer: "Edit connection",
      deleteServer: "Delete",
      deleteConfirm: "Confirm delete?",
      transport: "Transport",
      transportStdio: "Local process (stdio)",
      transportHttp: "Remote HTTP (streamable-http)",
      command: "Command",
      args: "Arguments (one per line)",
      env: "Environment variables",
      url: "URL",
      headers: "HTTP headers",
      cwd: "Working directory (optional)",
      addRow: "+ Add row",
      save: "Save",
      cancel: "Cancel",
      templates: "Templates",
      name: "Server name",
      desc: "One-line description",
      descPlaceholder: "Tells the model when to use it, e.g. repos / issues / PRs (optional; goes into the system-prompt catalog)",
      nameRequired: "Connects immediately on save — no restart",
      liveNote: "Connected, effective immediately",
      liveFailed: "Connection failed: ",
      removedLiveNote: "Disconnected and removed, effective immediately",
      managedBadge: "Live",
      connConnected: "Connected",
      connError: "Connection failed",
      connMissing: "No connection configured · click ✎ to add one",
      connDisconnected: "Disconnected",
      envRefHint: "${VAR} reference detected: secrets stay out of the config file",
      plaintextWarn: "Looks like a plaintext secret: it will be written verbatim into the config file; prefer a ${ENV_VAR} reference",
      errName: "Name allows letters, digits, underscore and hyphen (1-32 chars)",
      errExists: "This name is already in use",
      errUrl: "URL must start with http:// or https://",
      errCommand: "stdio servers require a command",
      noEdit: "This server is defined by a bundle; edit it in the owning bundle",
    };

    // 绑定翻译：apply() 里被 locale.bind(NS) 替换；服务不可用时按浏览器语言回退。
    var t = function (key) {
      var lang = (typeof navigator !== "undefined" && navigator.language) || "en";
      var dict = String(lang).toLowerCase().indexOf("zh") === 0 ? zh : en;
      return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
    };

    // ── 数据访问 ────────────────────────────────────────────────────────────
    function fetchState(workspacePath) {
      var query = workspacePath ? "?cwd=" + encodeURIComponent(workspacePath) : "";
      return fetch("/plugins/mcp-gate/state" + query, { cache: "no-store" })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload && payload.ok) return payload;
          throw new Error((payload && payload.error) || "state failed");
        });
    }

    function post(path, body) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload && payload.ok) return payload;
          throw new Error((payload && payload.error) || "request failed");
        });
    }

    // ── 接入表单（顶层组件：身份稳定，避免父渲染时 remount 丢输入） ────────────
    var NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
    var ENV_REF_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
    var SECRET_KEY_RE = /token|key|secret|password|authorization/i;

    var TEMPLATES = [
      {
        id: "github",
        label: "GitHub (HTTP)",
        data: {
          name: "github",
          description: "GitHub repositories, issues, pull requests and code search via GitHub Copilot MCP",
          transport: "streamable-http",
          url: "https://api.githubcopilot.com/mcp/",
          headerRows: [{ k: "Authorization", v: "Bearer ${GITHUB_TOKEN}" }],
        },
      },
      {
        id: "playwright",
        label: "Playwright (stdio)",
        data: {
          name: "playwright",
          description: "Browser automation: navigate, click, fill forms, screenshot and read pages",
          transport: "stdio",
          command: "npx",
          argsText: "@playwright/mcp@latest",
          envRows: [],
        },
      },
      {
        id: "fetch",
        label: "Fetch (stdio)",
        data: {
          name: "fetch",
          description: "Fetch web pages and convert them to markdown",
          transport: "stdio",
          command: "uvx",
          argsText: "mcp-server-fetch",
          envRows: [],
        },
      },
    ];

    function objToRows(obj) {
      return Object.keys(obj || {}).map(function (k) { return { k: k, v: String(obj[k]) }; });
    }

    function normalizeInitial(initial) {
      var c = initial || {};
      var form = {
        name: typeof c.name === "string" ? c.name : "",
        description: typeof c.description === "string" ? c.description : "",
        transport: c.transport === "streamable-http" ? "streamable-http" : "stdio",
        command: typeof c.command === "string" ? c.command : "",
        argsText: Array.isArray(c.args) ? c.args.join("\n") : "",
        envRows: objToRows(c.env),
        url: typeof c.url === "string" ? c.url : "",
        headerRows: objToRows(c.headers),
        cwd: typeof c.cwd === "string" ? c.cwd : "",
      };
      if (form.envRows.length === 0 && form.transport === "stdio") form.envRows = [{ k: "", v: "" }];
      if (form.headerRows.length === 0 && form.transport === "streamable-http") {
        form.headerRows = [{ k: "", v: "" }];
      }
      return form;
    }

    function rowsToMap(rows) {
      var out = {};
      (rows || []).forEach(function (row) {
        if (row.k && row.k.trim().length > 0) out[row.k.trim()] = row.v;
      });
      return out;
    }

    function kvRowProps(row, onChange) {
      var warn = row.k.trim().length > 0 && SECRET_KEY_RE.test(row.k) && !ENV_REF_RE.test(row.v);
      var ok = ENV_REF_RE.test(row.v);
      return { warn: warn && !ok, ok: ok };
    }

    function ServerForm(props) {
      var tr = props.tr;
      var useState = React.useState;
      var formState = useState(function () { return normalizeInitial(props.initial); });
      var form = formState[0];
      var setForm = formState[1];
      var errState = useState(null);
      var formError = errState[0];
      var setFormError = errState[1];
      var jsonModeState = useState(false);
      var jsonMode = jsonModeState[0];
      var setJsonMode = jsonModeState[1];
      var jsonTextState = useState("");
      var jsonText = jsonTextState[0];
      var setJsonText = jsonTextState[1];
      var jsonErrState = useState(null);
      var jsonError = jsonErrState[0];
      var setJsonError = jsonErrState[1];

      /** 添加弹窗顶部的模式切换：[手动填写 | 粘贴 JSON]。编辑模式无此切换。 */
      function modeSeg() {
        if (props.mode !== "add") return null;
        return React.createElement(
          "div",
          { className: "mcp-seg", style: { margin: "0 0 4px" } },
          [
            { id: "form", label: tr("tabForm") },
            { id: "json", label: tr("tabJson") },
          ].map(function (opt) {
            return React.createElement(
              "button",
              {
                key: opt.id,
                type: "button",
                "data-on": (jsonMode ? "json" : "form") === opt.id ? "true" : "false",
                onClick: function () { setJsonMode(opt.id === "json"); setFormError(null); setJsonError(null); },
              },
              opt.label
            );
          })
        );
      }

      function submitImport() {
        var text = jsonText.trim();
        if (!text) { setJsonError(tr("errJsonEmpty")); return; }
        try { JSON.parse(text); } catch (e) { setJsonError(tr("errJsonParse") + ": " + String((e && e.message) || e)); return; }
        setJsonError(null);
        props.onImport(text);
      }

      function patch(next) {
        setForm(function (prev) { return Object.assign({}, prev, next); });
      }

      function setRow(listKey, index, part, value) {
        setForm(function (prev) {
          var rows = prev[listKey].map(function (row, i) {
            return i === index ? Object.assign({}, row, part === "k" ? { k: value } : { v: value }) : row;
          });
          return Object.assign({}, prev, (function () { var n = {}; n[listKey] = rows; return n; })());
        });
      }

      function addRow(listKey) {
        setForm(function (prev) {
          var next = Object.assign({}, prev);
          next[listKey] = prev[listKey].concat([{ k: "", v: "" }]);
          return next;
        });
      }

      function delRow(listKey, index) {
        setForm(function (prev) {
          var next = Object.assign({}, prev);
          next[listKey] = prev[listKey].filter(function (_row, i) { return i !== index; });
          return next;
        });
      }

      function submit() {
        var name = form.name.trim();
        if (!NAME_RE.test(name)) { setFormError(tr("errName")); return; }
        if (props.mode === "add" && props.existingNames && props.existingNames.indexOf(name) >= 0) {
          setFormError(tr("errExists"));
          return;
        }
        var payload = { name: name, transport: form.transport };
        var description = form.description.trim();
        if (description.length > 0) payload.description = description.slice(0, 250);
        if (form.transport === "streamable-http") {
          if (!/^https?:\/\/.+/.test(form.url.trim())) { setFormError(tr("errUrl")); return; }
          payload.url = form.url.trim();
          payload.headers = rowsToMap(form.headerRows);
        } else {
          if (form.command.trim().length === 0) { setFormError(tr("errCommand")); return; }
          payload.command = form.command.trim();
          payload.args = form.argsText.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
          payload.env = rowsToMap(form.envRows);
          if (form.cwd.trim().length > 0) payload.cwd = form.cwd.trim();
        }
        setFormError(null);
        props.onSubmit(payload);
      }

      function input(key, label, extra) {
        return React.createElement(
          "div",
          { className: "mcp-field", key: key },
          React.createElement("span", { className: "mcp-field-label" }, label),
          React.createElement("input", Object.assign(
            {
              className: "mcp-input",
              value: form[key],
              disabled: key === "name" && props.mode === "edit",
              onChange: function (e) {
                var next = {};
                next[key] = e.target.value;
                patch(next);
              },
            },
            extra || {}
          ))
        );
      }

      function renderKv(listKey, keyLabel, valueLabel) {
        var rows = form[listKey];
        return React.createElement(
          "div",
          { className: "mcp-field", key: listKey },
          React.createElement("span", { className: "mcp-field-label" }, keyLabel + " / " + valueLabel),
          rows.map(function (row, index) {
            var flags = kvRowProps(row);
            return React.createElement(
              "div",
              { key: String(index) },
              React.createElement(
                "div",
                { className: "mcp-kv" },
                React.createElement("input", {
                  className: "mcp-input mcp-kv-key",
                  placeholder: "NAME",
                  value: row.k,
                  onChange: function (e) { setRow(listKey, index, "k", e.target.value); },
                }),
                React.createElement("input", {
                  className: "mcp-input",
                  placeholder: "value 或 ${ENV_VAR}",
                  value: row.v,
                  onChange: function (e) { setRow(listKey, index, "v", e.target.value); },
                }),
                React.createElement(
                  "button",
                  { type: "button", className: "mcp-kv-del", title: "×", onClick: function () { delRow(listKey, index); } },
                  "×"
                )
              ),
              flags.ok
                ? React.createElement("div", { className: "mcp-hint", "data-ok": "true" }, tr("envRefHint"))
                : null,
              flags.warn
                ? React.createElement("div", { className: "mcp-hint", "data-warn": "true" }, tr("plaintextWarn"))
                : null
            );
          }),
          React.createElement(
            "button",
            { type: "button", className: "mcp-template-chip", onClick: function () { addRow(listKey); } },
            tr("addRow")
          )
        );
      }

      if (jsonMode) {
        return React.createElement(
          "div",
          { className: "mcp-modal" },
          React.createElement("h3", { className: "mcp-modal-title" }, tr("addServer")),
          modeSeg(),
          React.createElement(
            "div",
            { className: "mcp-field" },
            React.createElement("span", { className: "mcp-field-label" }, tr("tabJson")),
            React.createElement("textarea", {
              className: "mcp-textarea",
              style: { minHeight: "180px", fontFamily: "var(--ds-font-family-code, monospace)", fontSize: "12px" },
              placeholder: tr("importPlaceholder"),
              value: jsonText,
              onChange: function (e) { setJsonText(e.target.value); },
            }),
            React.createElement("div", { className: "mcp-hint" }, tr("importHint"))
          ),
          jsonError ? React.createElement("p", { className: "mcp-error" }, jsonError) : null,
          React.createElement(
            "div",
            { className: "mcp-modal-actions" },
            React.createElement(
              "button",
              { type: "button", className: "mcp-btn", onClick: props.onClose },
              tr("cancel")
            ),
            React.createElement(
              "button",
              { type: "button", className: "mcp-btn mcp-btn-primary", onClick: submitImport },
              tr("importSubmit")
            )
          )
        );
      }

      var isHttp = form.transport === "streamable-http";
      return React.createElement(
        "div",
        { className: "mcp-modal" },
        React.createElement("h3", { className: "mcp-modal-title" }, props.mode === "edit" ? tr("editServer") : tr("addServer")),
        modeSeg(),
        React.createElement(
          "div",
          { className: "mcp-field" },
          React.createElement("span", { className: "mcp-field-label" }, tr("templates")),
          React.createElement(
            "div",
            { className: "mcp-templates" },
            props.mode === "add"
              ? TEMPLATES.map(function (tpl) {
                  return React.createElement(
                    "button",
                    {
                      key: tpl.id,
                      type: "button",
                      className: "mcp-template-chip",
                      onClick: function () {
                        setForm(normalizeInitial(Object.assign({ envRows: [], headerRows: [] }, tpl.data)));
                        setFormError(null);
                      },
                    },
                    tpl.label
                  );
                })
              : React.createElement("span", { className: "mcp-hint" }, tr("noEdit"))
          )
        ),
        input("name", tr("name") + (props.mode === "add" ? "" : "（固定）")),
        input("description", tr("desc"), { placeholder: tr("descPlaceholder") }),
        React.createElement(
          "div",
          { className: "mcp-field" },
          React.createElement("span", { className: "mcp-field-label" }, tr("transport")),
          React.createElement(
            "div",
            { className: "mcp-seg", style: { margin: "0" } },
            [
              { id: "stdio", label: tr("transportStdio") },
              { id: "streamable-http", label: tr("transportHttp") },
            ].map(function (opt) {
              return React.createElement(
                "button",
                {
                  key: opt.id,
                  type: "button",
                  "data-on": form.transport === opt.id ? "true" : "false",
                  disabled: props.mode === "edit",
                  onClick: function () { patch({ transport: opt.id }); },
                },
                opt.label
              );
            })
          )
        ),
        isHttp
          ? [input("url", tr("url")), renderKv("headerRows", "Header", "Value")]
          : [
              input("command", tr("command")),
              React.createElement(
                "div",
                { className: "mcp-field", key: "args" },
                React.createElement("span", { className: "mcp-field-label" }, tr("args")),
                React.createElement("textarea", {
                  className: "mcp-textarea",
                  value: form.argsText,
                  onChange: function (e) { patch({ argsText: e.target.value }); },
                })
              ),
              renderKv("envRows", "ENV", "Value"),
              input("cwd", tr("cwd")),
            ],
        props.mode === "add"
          ? React.createElement("div", { className: "mcp-hint" }, tr("nameRequired"))
          : null,
        formError ? React.createElement("p", { className: "mcp-error" }, formError) : null,
        React.createElement(
          "div",
          { className: "mcp-modal-actions" },
          React.createElement(
            "button",
            { type: "button", className: "mcp-btn", onClick: props.onClose },
            tr("cancel")
          ),
          React.createElement(
            "button",
            { type: "button", className: "mcp-btn mcp-btn-primary", onClick: submit },
            tr("save")
          )
        )
      );
    }

    // ── 设置页组件 ──────────────────────────────────────────────────────────
    function McpGateView(props) {
      var useWorkspaces = typeof props.useWorkspaces === "function" ? props.useWorkspaces : null;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;

      var workspaces = useWorkspaces !== null
        ? useWorkspaces(function (s) {
            return (s.items || []).map(function (w) {
              return { id: w.workspaceId, title: w.title, path: w.path };
            });
          })
        : [];
      var selectedState = useState(null);
      var selectedId = selectedState[0];
      var setSelectedId = selectedState[1];
      var workspace = null;
      for (var wi = 0; wi < workspaces.length; wi += 1) {
        if (workspaces[wi].id === selectedId) { workspace = workspaces[wi]; break; }
      }
      if (workspace === null && workspaces.length > 0) workspace = workspaces[0];
      var workspacePath = workspace ? workspace.path : undefined;

      var loadingState = useState(true);
      var loading = loadingState[0];
      var setLoading = loadingState[1];
      var errorState = useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var dataState = useState(null);
      var data = dataState[0];
      var setData = dataState[1];
      var tabState = useState("all");
      var activeTab = tabState[0];
      var setActiveTab = tabState[1];
      var expandedState = useState({});
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];
      var modalState = useState(null);
      var modal = modalState[0];
      var setModal = modalState[1];
      var noteState = useState(null);
      var submitNote = noteState[0];
      var setNote = noteState[1];
      var confirmState = useState(null);
      var confirming = confirmState[0];
      var setConfirming = confirmState[1];

      var load = useCallback(function () {
        setLoading(true);
        fetchState(workspacePath).then(function (payload) {
          setLoading(false);
          setData(payload);
          setError(null);
        }, function (err) {
          setLoading(false);
          setError(String((err && err.message) || err));
        });
      }, [workspacePath]);

      useEffect(function () { load(); }, [load]);

      function act(promise) {
        return promise.then(function () {
          setError(null);
          load();
        }, function (err) {
          setError(t("failed") + ": " + String((err && err.message) || err));
          load();
        });
      }

      if (!data) {
        return React.createElement(
          "div",
          { className: "mcp-section" },
          React.createElement(
            "div",
            { className: "mcp-head" },
            React.createElement("h2", { className: "mcp-title" }, t("title")),
            React.createElement("button", { type: "button", className: "mcp-refresh", onClick: load }, t("refresh"))
          ),
          loading
            ? React.createElement("p", { className: "mcp-empty" }, t("loading"))
            : error
              ? React.createElement("p", { className: "mcp-error" }, t("error") + ": " + error)
              : React.createElement("p", { className: "mcp-empty" }, t("empty"))
        );
      }

      var master = data.master !== false;
      var servers = data.servers || [];

      function toggleMaster() {
        act(post("/plugins/mcp-gate/master", { enabled: !master }));
      }

      function setGlobalEnabled(server, enabled) {
        act(post("/plugins/mcp-gate/global", { server: server, enabled: enabled }));
      }

      function setProject(server, value) {
        if (!workspacePath) return;
        act(post("/plugins/mcp-gate/project", { cwd: workspacePath, server: server, enabled: value }));
      }

      function setExposure(server, exposure) {
        act(post("/plugins/mcp-gate/global", { server: server, exposure: exposure }));
      }

      function setToolExposure(server, tool, value) {
        act(post("/plugins/mcp-gate/global", {
          server: server,
          tool: tool,
          toolExposure: value,
        }));
      }

      function saveServer(payload) {
        var path = modal && modal.mode === "edit" ? "/plugins/mcp-gate/update" : "/plugins/mcp-gate/add";
        setModal(null);
        act(
          post(path, payload).then(function (result) {
            if (result && result.applied === "live" && result.status === "connected") {
              setNote({ kind: "ok", text: t("liveNote") + " · " + result.server + " (" + result.tools + " " + t("tools") + ")" });
            } else if (result && result.applied === "live") {
              setNote({ kind: "warn", text: t("liveFailed") + (result.note || result.status || "") });
            } else {
              setNote({ kind: "warn", text: result && result.note ? result.note : t("failed") });
            }
          })
        );
      }

      function importServers(text) {
        setModal(null);
        act(
          post("/plugins/mcp-gate/import", { json: text }).then(function (result) {
            var parts = [];
            var added = (result && result.added) || [];
            var skipped = (result && result.skipped) || [];
            var failed = (result && result.failed) || [];
            if (added.length > 0) parts.push(t("importDone") + " " + added.length + " (" + added.join(", ") + ")");
            if (skipped.length > 0) {
              parts.push(t("importSkipped") + ": " + skipped.map(function (s) { return s.name + " — " + s.reason; }).join("; "));
            }
            if (failed.length > 0) {
              parts.push(t("importFailed") + ": " + failed.map(function (s) { return s.name + " — " + s.error; }).join("; "));
            }
            if (parts.length === 0) parts.push(t("importNothing"));
            setNote({ kind: failed.length > 0 ? "warn" : "ok", text: parts.join(" · ") });
          })
        );
      }

      function removeServer(name) {
        setConfirming(null);
        act(
          post("/plugins/mcp-gate/remove", { server: name }).then(function () {
            setNote({ kind: "ok", text: t("removedLiveNote") });
          })
        );
      }

      function toggleExpand(name) {
        setExpanded(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !prev[name];
          return next;
        });
      }

      var overrideCount = servers.filter(function (s) { return s.projectEnabled !== null; }).length;
      var enabledCount = servers.filter(function (s) { return s.enabled; }).length;

      var tabs = [
        { id: "all", label: t("tabAll"), count: servers.length },
        { id: "enabled", label: t("tabEnabled"), count: enabledCount },
        { id: "disabled", label: t("tabDisabled"), count: servers.length - enabledCount },
        { id: "override", label: t("tabOverride"), count: overrideCount },
      ];

      var visible = servers.filter(function (s) {
        if (activeTab === "enabled") return s.enabled;
        if (activeTab === "disabled") return !s.enabled;
        if (activeTab === "override") return s.projectEnabled !== null;
        return true;
      });

      function exposureBadge(server) {
        var map = { direct: t("direct"), deferred: t("deferred"), hidden: t("hidden") };
        return map[server.exposure] || server.exposure;
      }

      function dotState(server) {
        if (server.projectEnabled === true && server.enabled) return "project";
        if (server.projectEnabled === false && !server.enabled) return "project";
        return server.enabled ? "on" : "off";
      }

      function descText(server) {
        var parts = [];
        if (server.projectEnabled === false && server.globalEnabled) parts.push(t("projectDisabled"));
        if (server.projectEnabled === true && !server.globalEnabled) parts.push(t("projectEnabledOnly"));
        if (server.connStatus === "error" && server.connError) parts.push("⚠ " + String(server.connError).slice(0, 160));
        else if (server.connStatus === "connected") parts.push(t("connConnected") + " · " + server.connTools + " " + t("tools"));
        else if (server.connectorMissing) parts.push(t("connMissing"));
        else if (server.connStatus === "disconnected") parts.push(t("connDisconnected"));
        return parts.join(" · ");
      }

      function connBadge(server) {
        if (server.managed && server.connStatus === "connected") {
          return React.createElement("span", { className: "mcp-badge", "data-live": "true" }, t("managedBadge"));
        }
        return null;
      }

      function renderTools(server) {
        var rows = server.tools || [];
        if (rows.length === 0) {
          return React.createElement("p", { className: "mcp-empty" }, t("empty"));
        }
        return rows.map(function (tool) {
          return React.createElement(
            "div",
            { key: tool.name, className: "mcp-tool-row" },
            React.createElement(
              "span",
              {
                className: "mcp-tool-name",
                title: t("toolReset"),
                onClick: function () { setToolExposure(server.name, tool.raw, null); },
              },
              tool.raw
            ),
            tool.overridden
              ? React.createElement("span", { className: "mcp-badge" }, "direct*")
              : null,
            React.createElement(
              "span",
              { className: "mcp-tool-desc", title: tool.description },
              tool.description
            ),
            React.createElement(
              "span",
              { className: "mcp-seg", "data-override": tool.overridden ? "true" : "false" },
              ["direct", "deferred", "hidden"].map(function (ex) {
                return React.createElement(
                  "button",
                  {
                    key: ex,
                    type: "button",
                    "data-on": tool.exposure === ex ? "true" : "false",
                    onClick: function () { setToolExposure(server.name, tool.raw, tool.exposure === ex ? null : ex); },
                  },
                  ex
                );
              })
            )
          );
        });
      }

      function renderRow(server) {
        var isOpen = !!expanded[server.name];
        var tri = server.projectEnabled === null ? "inherit" : server.projectEnabled ? "on" : "off";
        return React.createElement(
          "div",
          { key: server.name, className: "mcp-row", "data-disabled": server.enabled ? "false" : "true" },
          React.createElement("span", { className: "mcp-dot", "data-state": dotState(server) }),
          React.createElement(
            "div",
            { className: "mcp-row-main", onClick: function () { toggleExpand(server.name); } },
            React.createElement(
              "div",
              { className: "mcp-row-name" },
              server.name,
              React.createElement("span", { className: "mcp-badge" }, exposureBadge(server)),
              React.createElement("span", { className: "mcp-badge" }, server.toolCount + " " + t("tools")),
              connBadge(server)
            ),
            server.description
              ? React.createElement(
                  "div",
                  { className: "mcp-row-desc", title: server.description },
                  server.description
                )
              : null,
            descText(server)
              ? React.createElement(
                  "div",
                  { className: "mcp-row-desc" },
                  React.createElement("span", { className: "mcp-overridden" }, descText(server))
                )
              : null
          ),
          React.createElement(
            "button",
            {
              type: "button",
              role: "switch",
              "aria-checked": server.globalEnabled ? "true" : "false",
              "aria-label": t("globalSwitch") + ": " + server.name,
              title: t("globalSwitch"),
              className: "mcp-switch",
              "data-on": server.globalEnabled ? "true" : "false",
              onClick: function () { setGlobalEnabled(server.name, !server.globalEnabled); },
            },
            React.createElement("span", { className: "mcp-thumb" })
          ),
          React.createElement(
            "span",
            { className: "mcp-tri", "data-override": tri === "inherit" ? "false" : "true" },
            [
              { id: "inherit", label: t("inherit") },
              { id: "on", label: t("projectOn") },
              { id: "off", label: t("projectOff") },
            ].map(function (option) {
              return React.createElement(
                "button",
                {
                  key: option.id,
                  type: "button",
                  "data-on": tri === option.id ? "true" : "false",
                  disabled: !workspacePath && option.id !== "inherit",
                  onClick: function () {
                    setProject(server.name, option.id === "inherit" ? null : option.id === "on");
                  },
                },
                option.label
              );
            })
          ),
          server.editable
            ? React.createElement(
                "span",
                { className: "mcp-row-actions" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "mcp-icon-btn",
                    title: t("editServer"),
                    onClick: function () { setModal({ mode: "edit", server: server.name }); },
                  },
                  "✎"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "mcp-icon-btn",
                    title: t("deleteServer"),
                    "data-danger": "true",
                    "data-confirm": confirming === server.name ? "true" : "false",
                    onClick: function () {
                      if (confirming === server.name) { removeServer(server.name); return; }
                      setConfirming(server.name);
                      setTimeout(function () { setConfirming(function (cur) { return cur === server.name ? null : cur; }); }, 3000);
                    },
                  },
                  confirming === server.name ? t("deleteConfirm") : "✕"
                )
              )
            : null,
          isOpen
            ? React.createElement(
                "div",
                { className: "mcp-tools" },
                React.createElement(
                  "span",
                  { className: "mcp-tools-title" },
                  t("exposureLabel") + " · " + server.toolCount + " " + t("tools")
                ),
                renderTools(server)
              )
            : null
        );
      }

      var picker = workspaces.length > 0
        ? React.createElement(
            "div",
            { className: "mcp-picker" },
            React.createElement("span", { className: "mcp-picker-label" }, t("workspace")),
            React.createElement(
              "select",
              {
                className: "mcp-picker-select",
                value: workspace ? workspace.id : "",
                onChange: function (e) { setSelectedId(e.target.value); },
              },
              workspaces.map(function (w) {
                var label = (w.title || w.id) + (w.path ? " — " + w.path : "");
                return React.createElement("option", { key: w.id, value: w.id }, label);
              })
            )
          )
        : React.createElement("p", { className: "mcp-note" }, t("noWorkspace"));

      return React.createElement(
        "div",
        { className: "mcp-section" },
        React.createElement(
          "div",
          { className: "mcp-head" },
          React.createElement("h2", { className: "mcp-title" }, t("title")),
          React.createElement(
            "div",
            { className: "mcp-master" },
            React.createElement("span", { className: "mcp-master-label" }, t("master")),
            React.createElement(
              "button",
              {
                type: "button",
                role: "switch",
                "aria-checked": master ? "true" : "false",
                className: "mcp-switch",
                "data-on": master ? "true" : "false",
                onClick: toggleMaster,
              },
              React.createElement("span", { className: "mcp-thumb" })
            ),
            React.createElement("button", { type: "button", className: "mcp-refresh", onClick: load }, t("refresh")),
            React.createElement(
              "button",
              {
                type: "button",
                className: "mcp-add-btn",
                onClick: function () { setModal({ mode: "add" }); },
              },
              "+ " + t("addServer")
            )
          )
        ),
        React.createElement("p", { className: "mcp-intro" }, t("intro")),
        !master ? React.createElement("p", { className: "mcp-note" }, t("masterOffNote")) : null,
        submitNote
          ? React.createElement(
              "div",
              { className: "mcp-note-bar", "data-kind": submitNote.kind },
              submitNote.text,
              React.createElement(
                "button",
                { type: "button", className: "mcp-note-close", onClick: function () { setNote(null); } },
                "×"
              )
            )
          : null,
        picker,
        React.createElement(
          "div",
          { className: "mcp-tabs" },
          tabs.map(function (tab) {
            return React.createElement(
              "button",
              {
                key: tab.id,
                type: "button",
                className: "mcp-tab",
                "data-active": activeTab === tab.id ? "true" : "false",
                onClick: function () { setActiveTab(tab.id); },
              },
              tab.label,
              React.createElement("span", { className: "mcp-tab-count" }, String(tab.count))
            );
          })
        ),
        error ? React.createElement("p", { className: "mcp-error" }, error) : null,
        visible.length === 0
          ? React.createElement("p", { className: "mcp-empty" }, t("empty"))
          : React.createElement(
              "div",
              { className: "mcp-list" },
              visible.map(renderRow)
            ),
        modal
          ? React.createElement(
              "div",
              {
                className: "mcp-modal-mask",
                onClick: function (e) { if (e.target === e.currentTarget) setModal(null); },
              },
              React.createElement(ServerForm, {
                mode: modal.mode,
                tr: t,
                initial: modal.mode === "edit"
                  ? (function () {
                      var view = servers.filter(function (s) { return s.name === modal.server; })[0] || {};
                      return Object.assign(
                        { name: modal.server, description: view.description || "" },
                        view.connector || {}
                      );
                    })()
                  : null,
                existingNames: modal.mode === "add"
                  ? servers.map(function (s) { return s.name; })
                  : null,
                onSubmit: saveServer,
                onImport: importServers,
                onClose: function () { setModal(null); },
              })
            )
          : null
      );
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    var inject = ["slots", "locale"];

    function apply(ctx) {
      var locale = ctx.get("locale");
      if (locale) {
        ctx.effect(
          function () {
            return locale.register(NS, { zh: zh, en: en });
          },
          "mcp-gate: locales"
        );
        t = locale.bind(NS);
      }
      var slots = ctx.get("slots");
      if (slots) {
        slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "mcp-gate", order: 26, label: function () { return t("nav"); } },
            McpGateView
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
