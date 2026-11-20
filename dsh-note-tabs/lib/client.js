// dsh-note-tabs — client 面
//
// 五个插槽（设置不再是独立 section，而是详情页里的一个 tab）：
//   conversation.chat.assistant-actions — 回复下方收藏按钮（session 作用域）
//   sidebar.panellist                   — 左栏图标（root）
//   main (key = note-tabs)              — 便签详情页 + 设置 tab（root）
//   shell.overlay                       — hover 浮层 + 撤销 Toast（root）
// 详情页页头带「返回会话」按钮，回到当前 session。
//
// 数据通道：POST /plugins/note-tabs/rpc（host 面 lib/index.js）。
// 只存正文原文；工作区名/会话名展示时现查，查不到显示「未知工作区 / 未知会话」。

window.__ModuleLoader__.load({
  id: "dsh-note-tabs",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    // Markdown 渲染复用 DSH 自己的基线模块：它就是对话区里 AssistantMarkdown 内部
    // 实际使用的 MarkdownText（micromark + KaTeX + shiki），属 PLATFORM_MODULES。
    // 取不到时降级成纯文本，绝不自己再写一个解析器。
    var primitives = null;
    try { primitives = require("@deepseek-ai/dsh-client-ui-primitives") || null; } catch (error) { primitives = null; }
    // React.memo 的返回值是对象而不是函数：必须同时接受 object，否则永远降级成纯文本。
    var MarkdownText = primitives !== null && primitives.MarkdownText != null
      && (typeof primitives.MarkdownText === "function" || typeof primitives.MarkdownText === "object")
      ? primitives.MarkdownText : null;

    var PANEL_ID = "note-tabs";
    var RPC = "/plugins/note-tabs/rpc";
    var BT = String.fromCharCode(96);
    var FENCE = BT + BT + BT;
    var h = React.createElement;

    // ── 文案 ─────────────────────────────────────────────────────────────────
    var DICT = {
      zh: {
        title: "便签",
        countUnit: "{n} 条",
        hoverTitle: "当前工作区",
        hoverAll: "查看全部便签",
        hoverEmpty: "这个工作区还没有便签",
        search: "搜索正文…",
        grouped: "按工作区",
        flat: "全部",
        empty: "还没有便签",
        emptyHint: "在任意回答下方点收藏图标，就会出现在这里",
        pageSub: "收藏自各轮回答的 Markdown 片段，或自己写。点卡片可展开，hover 出行内操作。",
        back: "返回会话",
        tabNotes: "便签",
        tabSettings: "设置",
        noMatch: "没有匹配的便签",
        noMatchHint: "换个关键词，或清空搜索框",
        retry: "重试",
        close: "关闭",
        send: "传送到输入框",
        edit: "编辑",
        del: "删除",
        save: "保存",
        cancel: "取消",
        deleted: "已删除",
        savedToast: "已收藏到便签",
        undo: "撤销",
        sent: "已发送到输入框",
        sendBlocked: "输入框当前不接受插入",
        noSession: "先在会话里打开输入框",
        unknownWs: "未知工作区",
        unknownSession: "未知会话",
        saved: "已收藏",
        saveAction: "收藏这条回答",
        cannot: "暂时取不到这条回答的正文",
        duplicate: "已有内容相同的便签",
        settingsSub: "三项偏好，写入 ~/.dsh/storages/dsh-note-tabs/notes.json",
        hoverCount: "悬浮框条数",
        hoverCountHint: "侧栏图标 hover 时列出最近几条",
        hoverEnabled: "启用悬浮框",
        hoverEnabledHint: "关闭后 hover 不弹出，仅点击进入详情",
        defaultView: "默认视图",
        defaultViewHint: "详情页打开时的排列方式",
        preview: "实时预览",
        newNote: "新建便签",
        newNoteHint: "自己写一条，不依赖任何回答",
        draftTitle: "新建便签",
        draftPlaceholder: "写下这条便签的 Markdown 正文…",
        draftEmpty: "正文不能为空",
        hoverAdd: "在这条浮层里新建便签",
        composeDropped: "草稿已丢弃，请在详情页重新填写",
        undoFailed: "撤销失败",
        storeFull: "便签数量已达上限",
        noteMissing: "这条便签已经不在了",
        copy: "复制正文",
        copied: "已复制到剪贴板",
        copyBlocked: "剪贴板不可用",
        previewTitle: "预览便签",
        editTitle: "编辑便签",
        openPreview: "点开预览全文",
      },
      en: {
        title: "Notes",
        countUnit: "{n}",
        hoverTitle: "This workspace",
        hoverAll: "See all notes",
        hoverEmpty: "No notes in this workspace yet",
        search: "Search notes…",
        grouped: "By workspace",
        flat: "All",
        empty: "No notes yet",
        emptyHint: "Click the bookmark under any answer to save it here",
        pageSub: "Markdown excerpts saved from answers, or written yourself. Click a card to expand; hover for actions.",
        back: "Back to chat",
        tabNotes: "Notes",
        tabSettings: "Settings",
        noMatch: "No matching notes",
        noMatchHint: "Try another keyword, or clear the search",
        retry: "Retry",
        close: "Close",
        send: "Send to composer",
        edit: "Edit",
        del: "Delete",
        save: "Save",
        cancel: "Cancel",
        deleted: "Deleted",
        savedToast: "Saved to notes",
        undo: "Undo",
        sent: "Sent to composer",
        sendBlocked: "The composer refuses the insertion right now",
        noSession: "Open a conversation first",
        unknownWs: "Unknown workspace",
        unknownSession: "Unknown session",
        saved: "Saved",
        saveAction: "Save this answer as a note",
        cannot: "The answer text is unavailable right now",
        duplicate: "A note with the same text already exists",
        settingsSub: "Three preferences, stored in ~/.dsh/storages/dsh-note-tabs/notes.json",
        hoverCount: "Hover card rows",
        hoverCountHint: "How many recent notes the sidebar hover lists",
        hoverEnabled: "Enable hover card",
        hoverEnabledHint: "When off, hovering does nothing and only a click opens the page",
        defaultView: "Default view",
        defaultViewHint: "How the notes page arranges notes",
        preview: "Live preview",
        newNote: "New note",
        newNoteHint: "Write one yourself, independent of any answer",
        draftTitle: "New note",
        draftPlaceholder: "Write this note's Markdown body…",
        draftEmpty: "The body cannot be empty",
        hoverAdd: "New note from this card",
        composeDropped: "Draft discarded — write it again on the notes page",
        undoFailed: "Undo failed",
        storeFull: "You have reached the note limit",
        noteMissing: "That note is gone",
        copy: "Copy body",
        copied: "Copied to clipboard",
        copyBlocked: "Clipboard unavailable",
        previewTitle: "Preview note",
        editTitle: "Edit note",
        openPreview: "Open the full note",
      },
    };

    var lang = "zh";
    function t(key, extra) {
      var dict = DICT[lang] || DICT.zh;
      var value = dict[key] === undefined ? DICT.en[key] : dict[key];
      if (value === undefined) return key;
      return extra === undefined ? value : String(value).replace("{n}", String(extra));
    }

    // MarkdownText 的 chrome 文案：每种语言一份常量，引用恒定。
    // 引用恒定：MarkdownText 用 labels 的引用身份判断是否需要重建组件表。
    var MD_LABELS_ZH = { code: { copyLabel: "复制", copiedLabel: "已复制" }, footnotes: "脚注" };
    var MD_LABELS_EN = { code: { copyLabel: "Copy", copiedLabel: "Copied" }, footnotes: "Footnotes" };
    function markdownLabels() { return lang === "en" ? MD_LABELS_EN : MD_LABELS_ZH; }
    var MD_LABELS = MD_LABELS_ZH;

    // ── 样式 ─────────────────────────────────────────────────────────────────
    // 字体只走 DSH 自己的 token，不写死字体栈：这两个变量已经把内置栈和用户在
    // 设置里选的「文本字体 / 代码字体」合成好了，跟着主题一起变。
    var FONT_TEXT = "var(--dsw-font-family)";

    var css = [
      ".dnt-root{color:var(--dsw-alias-label-primary);font-family:" + FONT_TEXT + "}",
      // 对话区回复下方的 action：与宿主 MessageIconActions 完全同尺寸（28px + 字号增量）。
      ".dnt-hact{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
      ".dnt-hact svg{flex:none;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px))}",
      "@media (hover:hover){.dnt-hact:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}",
      ".dnt-hact:disabled{cursor:default;opacity:.4}",
      ".dnt-hact[aria-pressed='true']{color:var(--dsw-alias-brand-primary)}",
      ".dnt-hact[aria-pressed='true']:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}",
      ".dnt-act{width:26px;height:26px;border-radius:6px;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);background:none;border:none;cursor:pointer;padding:0;transition:color .13s,background .13s}",
      ".dnt-act:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary)}",
      ".dnt-act svg{width:14px;height:14px;display:block}",
      ".dnt-act[aria-pressed='true']{color:var(--dsw-alias-brand-primary)}",
      ".dnt-act[aria-pressed='true']:hover{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(63,109,90,.12))}",
      ".dnt-act:disabled{opacity:.42;cursor:default}",
      ".dnt-root button:focus-visible,.dnt-root input:focus-visible,.dnt-root select:focus-visible,.dnt-root textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
      ".dnt-rail{position:relative;display:grid;place-items:center;cursor:pointer;color:var(--dsw-alias-label-tertiary);background:none;border:none;padding:0}",
      ".dnt-rail[data-active='true']{color:var(--dsw-alias-brand-primary)}",
      ".dnt-rail svg{display:block}",
      ".dnt-rail .dnt-cnt{position:absolute;top:-2px;right:-4px;min-width:13px;height:13px;padding:0 3px;border-radius:7px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1,#fff);font:600 8.5px/13px " + FONT_TEXT + ";text-align:center}",
      ".dnt-hover{position:fixed;z-index:60;width:352px;max-height:min(62vh,520px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:13px;box-shadow:0 18px 44px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.06);opacity:0;transform:translateX(-6px) scale(.985);transform-origin:left top;transition:opacity .13s ease-out,transform .13s ease-out;pointer-events:none}",
      // 打开态：这一条是浮层能被看见的唯一开关。基础样式是 opacity:0 + pointer-events:none，
      // 删掉这条规则的表现就是「hover 有反应但什么也不显示」。
      ".dnt-hover[data-open='true']{opacity:1;transform:none;pointer-events:auto}",
      "@media (prefers-reduced-motion:reduce){.dnt-hover{transition:none}}",
      ".dnt-hc-head{padding:9px 9px 8px 13px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));display:flex;align-items:center;gap:8px;flex:none}",
      ".dnt-hc-h{font:600 12.5px/1.3 " + FONT_TEXT + ";letter-spacing:.02em;white-space:nowrap}",
      ".dnt-hc-ws{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dnt-hc-add{flex:none;display:grid;place-items:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
      ".dnt-hc-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}",
      ".dnt-hc-add svg{width:14px;height:14px;display:block}",
      ".dnt-hc-compose{padding:8px 9px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));flex:none}",
      ".dnt-hc-compose textarea{width:100%;box-sizing:border-box;min-height:76px;max-height:180px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);padding:7px 9px;font:var(--dsh-content-font-size,14px)/1.55 " + FONT_TEXT + ";color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);outline:none;resize:vertical}",
      ".dnt-hc-compose textarea::placeholder{color:var(--dsw-alias-markdown-placeholder)}",
      ".dnt-hc-compose textarea:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".dnt-hc-compose-row{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:6px}",
      ".dnt-hc-hint{flex:1;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-hc-scroll{overflow:auto;padding:5px 6px 6px;min-height:0}",
      // 一行两行正文 + 右侧两个动作（传送 / 复制）。动作默认隐去，hover 或键盘聚焦才出现。
      ".dnt-hc-row{display:flex;align-items:flex-start;gap:4px;padding:7px 6px 7px 8px;border-radius:8px}",
      // 行间分割线：相邻两条便签之间一条发丝线，让「这是两条独立记录」一眼可见。
      ".dnt-hc-row + .dnt-hc-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}",
      ".dnt-hc-t{flex:1;min-width:0;margin:0;font-size:calc(var(--dsh-content-font-size,14px) * .9);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word}",
      ".dnt-hc-acts{flex:none;display:flex;gap:1px;opacity:0;transition:opacity .12s}",
      ".dnt-hc-row:hover .dnt-hc-acts,.dnt-hc-row:focus-within .dnt-hc-acts{opacity:1}",
      ".dnt-hc-go{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:6px;background:none;border:none;cursor:pointer;padding:0;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-hc-go:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-brand-primary)}",
      ".dnt-hc-go svg{width:14px;height:14px;display:block}",
      ".dnt-hc-foot{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));padding:6px}",
      ".dnt-hc-all{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-radius:8px;border:none;background:none;cursor:pointer;font:500 12.5px " + FONT_TEXT + ";color:var(--dsw-alias-label-secondary);text-align:left}",
      ".dnt-hc-all:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}",
      ".dnt-hc-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
      // 版面：一处居中栏，页头 → 页签 → 工具条 → 内容。分组靠留白与页首标签分隔，
      // 不再到处画横线（上一版每个分组、每张卡都带一条线，读起来发糊）。
      ".dnt-page{height:100%;overflow:auto;box-sizing:border-box}",
      ".dnt-page-in{max-width:880px;margin:0 auto;padding:16px 32px 96px}",
      ".dnt-head{display:flex;align-items:center;gap:10px}",
      ".dnt-back{display:grid;place-items:center;width:28px;height:28px;flex:none;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
      ".dnt-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dnt-back svg{width:15px;height:15px;display:block}",
      ".dnt-head-main{flex:1;min-width:0;display:flex;align-items:baseline;gap:9px}",
      ".dnt-title{font:600 21px/1.25 " + FONT_TEXT + ";letter-spacing:-.004em;margin:0}",
      ".dnt-count{font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
      // 主操作只有一个：新建。实心品牌色，页头右侧，不跟搜索挤在一行。
      ".dnt-new{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px 0 8px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1,#fff);font:500 12.5px " + FONT_TEXT + ";cursor:pointer}",
      ".dnt-new:hover{filter:brightness(1.07)}",
      ".dnt-new svg{width:14px;height:14px;display:block}",
      ".dnt-tabs{display:flex;gap:18px;margin:10px 0 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}",
      ".dnt-tab{padding:6px 1px 8px;border:none;background:none;cursor:pointer;font:500 12.5px " + FONT_TEXT + ";color:var(--dsw-alias-label-tertiary);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s}",
      ".dnt-tab:hover{color:var(--dsw-alias-label-primary)}",
      ".dnt-tab[aria-selected='true']{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}",
      // 工具条：搜索是填充底而不是描边框，视觉重量低于卡片本身。
      ".dnt-sub{margin:8px 0 0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-tool{display:flex;align-items:center;gap:8px;margin:12px 0 10px}",
      ".dnt-search{flex:1;min-width:0;display:flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid transparent;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover)}",
      ".dnt-search:focus-within{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dnt-search svg{width:13px;height:13px;color:var(--dsw-alias-label-tertiary);flex:none}",
      ".dnt-search input{flex:1;border:none;outline:none;background:none;font:12.5px " + FONT_TEXT + ";color:inherit;min-width:0}",
      ".dnt-seg{display:flex;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);overflow:hidden;flex:none}",
      ".dnt-seg button{padding:0 10px;height:28px;font:500 12px " + FONT_TEXT + ";color:var(--dsw-alias-label-tertiary);border:none;background:none;cursor:pointer}",
      ".dnt-seg button[aria-pressed='true']{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}",
      // 分组标题：品牌色短竖线 + 名字，计数推到右边缘，上下不再画满宽横线。
      ".dnt-group{margin-bottom:18px}",
      ".dnt-group-h{display:flex;align-items:center;gap:8px;padding:0 0 7px}",
      ".dnt-g-t{font:600 11.5px/1.3 " + FONT_TEXT + ";color:var(--dsw-alias-label-secondary)}",
      ".dnt-g-t::before{content:'';display:inline-block;width:2px;height:10px;margin-right:7px;border-radius:1px;background:var(--dsw-alias-brand-primary);vertical-align:-1px}",
      ".dnt-g-n{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
      // Q6b：自动填充 300px 列（与设计稿 mock.html / design README 一致）
      ".dnt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;margin-top:2px}",
      // 卡片：只有一条发丝描边，无阴影。整页唯一的高饱和动作是 hover 时左缘那道品牌色
      // 竖线——它把「这一张是你正在看的」说清楚，其余一切保持安静。
      ".dnt-note{position:relative;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#fff);padding:10px 12px 6px;transition:border-color .14s}",
      ".dnt-note::before{content:'';position:absolute;left:-1px;top:11px;bottom:11px;width:2px;border-radius:2px;background:var(--dsw-alias-brand-primary);opacity:0;transition:opacity .14s}",
      ".dnt-note:hover{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.14))}",
      ".dnt-note:hover::before,.dnt-note:focus-within::before{opacity:.6}",
      // 折叠态：正文 3 行截断。行数从 4 收到 3，卡片才不会被标题撑成不等高的一条条。
      ".dnt-body{margin:0;font-size:calc(var(--dsh-content-font-size,14px) * .9);line-height:1.62;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word;flex:1;cursor:zoom-in}",
      // 展开态由 MarkdownText 自己排版（它带 --dsw-font-markdown-base 与全套块级样式），
      // 这里只负责容器：首尾块贴边、滚动条退让。
      ".dnt-md-fallback{margin:0;font-size:calc(var(--dsh-content-font-size,14px) * .9);line-height:1.62;white-space:pre-wrap;word-break:break-word}",
      ".dnt-modal-body .dnt-md-fallback{white-space:pre-wrap}",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      // 卡片脚：只有来源名，操作按钮默认隐去，hover / 键盘聚焦才出现。
      // 常驻三个图标会让每张卡片都像工具栏，也压掉了正文的份量。
      // 正文与卡片底部之间一条发丝分割线：把「内容」和「元信息/动作」分成两层。
      ".dnt-foot{display:flex;align-items:center;gap:4px;margin-top:9px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));min-height:22px}",
      ".dnt-src{flex:1;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dnt-acts{display:flex;gap:1px;flex:none;opacity:0;transition:opacity .12s}",
      ".dnt-note:hover .dnt-acts,.dnt-note:focus-within .dnt-acts,.dnt-note[data-open='true'] .dnt-acts{opacity:1}",
      ".dnt-act.dnt-danger:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}",
      ".dnt-edit{flex:1;min-width:0}",
      ".dnt-note[data-editing='true']{border-color:var(--dsw-alias-brand-primary)}",
      ".dnt-edit textarea{width:100%;box-sizing:border-box;min-height:104px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);padding:9px 11px;font:var(--dsh-content-font-size,14px)/1.6 " + FONT_TEXT + ";color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);outline:none;resize:vertical}",
      ".dnt-edit textarea::placeholder{color:var(--dsw-alias-markdown-placeholder)}",
      ".dnt-edit textarea:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".dnt-edit-label{font:600 10.5px/1.4 " + FONT_TEXT + ";letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);margin-bottom:6px}",
      ".dnt-row{display:flex;gap:7px;justify-content:flex-end;margin-top:8px}",
      ".dnt-btn{padding:4px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));font:500 12px " + FONT_TEXT + ";color:var(--dsw-alias-label-primary);background:none;cursor:pointer}",
      ".dnt-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}",
      ".dnt-btn.dnt-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dnt-btn.dnt-primary:hover{filter:brightness(1.06)}",
      ".dnt-empty{padding:56px 0;text-align:center;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-e-t{font:600 15px/1.4 " + FONT_TEXT + ";color:var(--dsw-alias-label-secondary);margin-bottom:5px}",
      ".dnt-e-d{font-size:12.5px;max-width:34ch;margin:0 auto}",
      ".dnt-empty .dnt-new{margin-left:auto;margin-right:auto}",
      ".dnt-set{display:grid;grid-template-columns:1fr 300px;gap:28px;align-items:start}",
      ".dnt-set h3{margin:0 0 4px;font:600 15px/1.4 " + FONT_TEXT + "}",
      ".dnt-s-sub{margin:0 0 8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-srow{display:flex;align-items:center;gap:14px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}",
      ".dnt-s-l{flex:1;min-width:0}",
      ".dnt-s-n{font-size:13px}",
      ".dnt-s-d{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
      ".dnt-srow input[type='number']{width:64px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:6px;background:transparent;color:inherit;font:13px " + FONT_TEXT + ";outline:none}",
      ".dnt-srow select{padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:6px;background:transparent;color:inherit;font:13px " + FONT_TEXT + ";outline:none}",
      ".dnt-sw{width:34px;height:19px;border-radius:10px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.14));position:relative;flex:none;transition:background .16s;border:none;cursor:pointer;padding:0}",
      ".dnt-sw::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:translate .16s}",
      ".dnt-sw[aria-checked='true']{background:var(--dsw-alias-brand-primary)}",
      ".dnt-sw[aria-checked='true']::after{translate:15px 0}",
      ".dnt-pv{position:sticky;top:0}",
      ".dnt-pv-label{font:600 11px/1.4 " + FONT_TEXT + ";letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);margin-bottom:8px}",
      ".dnt-pv-card{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);padding:10px 11px 7px}",
      ".dnt-pv-card .dnt-body{-webkit-line-clamp:3}",
      ".dnt-pv-group{padding-bottom:5px;margin-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));font:600 10.5px/1.3 " + FONT_TEXT + ";color:var(--dsw-alias-label-secondary)}",
      ".dnt-pv-hover{margin-top:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:11px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 22px rgba(0,0,0,.1);overflow:hidden}",
      ".dnt-pv-hover .dnt-hc-head{padding:8px 10px 6px}",
      ".dnt-pv-r{padding:5px 10px;font-size:calc(var(--dsh-content-font-size,14px) * .76);line-height:1.45;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dnt-pv-r:last-child{border-bottom:none}",
      ".dnt-pv-faded{opacity:.55}",
      ".dnt-pv-hint{margin-top:8px;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".dnt-pv-foot{margin-top:8px;padding:5px 8px;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      // ── 便签弹窗（预览 / 编辑）──
      ".dnt-modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(0,0,0,.32);padding:16px}",
      "@media (prefers-reduced-motion:reduce){.dnt-modal{background:rgba(0,0,0,.4)}}",
      "@media (max-width:820px){.dnt-modal-box{width:calc(100vw - 32px);height:70vh}}",
      // 60vw × 60vh：Markdown 长文与编辑都需要横向空间，640px 会折行过多。
      ".dnt-modal-box{display:flex;flex-direction:column;width:min(60vw,100%);height:min(60vh,100%);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 24px 64px rgba(0,0,0,.24);overflow:hidden}",
      ".dnt-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));flex:none}",
      ".dnt-modal-title{flex:1;font:600 13px/1.3 " + FONT_TEXT + ";color:var(--dsw-alias-label-primary)}",
      ".dnt-modal-x{display:grid;place-items:center;width:24px;height:24px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;font-size:12px}",
      ".dnt-modal-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dnt-modal-body{flex:1;min-height:0;overflow:auto;padding:16px 18px}",
      ".dnt-modal-body:has(.dnt-modal-area){display:flex}",
      ".dnt-modal-area{width:100%;box-sizing:border-box;min-height:0;height:100%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);padding:10px 12px;font:var(--dsh-content-font-size,14px)/1.6 " + FONT_TEXT + ";color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);outline:none;resize:vertical}",
      ".dnt-modal-area:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".dnt-modal-foot{display:flex;justify-content:flex-end;gap:7px;padding:10px 14px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));flex:none}",
      ".dnt-modal-foot .dnt-btn{display:inline-flex;align-items:center;gap:5px}",
      ".dnt-modal-foot .dnt-btn svg{width:13px;height:13px;display:block}",
      ".dnt-toasts{position:fixed;bottom:22px;left:50%;translate:-50% 0;z-index:80;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}",
      ".dnt-toast{display:flex;align-items:center;gap:12px;padding:8px 10px 8px 14px;border-radius:9px;background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-bg-layer-1,#fff);font-size:12.5px;box-shadow:0 10px 30px rgba(0,0,0,.22);pointer-events:auto;font-family:" + FONT_TEXT + "}",
      ".dnt-toast button{color:inherit;font-weight:600;font-size:12.5px;text-decoration:underline;text-underline-offset:2px;background:none;border:none;cursor:pointer}",
      ".dnt-toast .dnt-toast-x{text-decoration:none;opacity:.65;font-weight:400;padding:0 2px}",
      ".dnt-toast .dnt-toast-x:hover{opacity:1}",
      "@media (max-width:720px){.dnt-set{grid-template-columns:1fr}.dnt-pv{display:none}.dnt-page-in{padding:16px 16px 60px}}",
    ].join("\n");

    var STYLE_TAG_ID = "dsh-note-tabs/client.css";

    /** 注入样式并返回卸载器：禁用插件时 style 必须跟着移除，否则会残留覆盖宿主样式。 */
    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]");
      if (existing !== null) {
        return function () { /* 已有实例持有时不重复接管 */ };
      }
      var styleTag = document.createElement("style");
      styleTag.dataset.plugin = "dsh-note-tabs";
      styleTag.dataset.pluginCss = STYLE_TAG_ID;
      styleTag.textContent = css;
      document.head.appendChild(styleTag);
      return function () {
        if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
      };
    }

    // ── 客户端状态仓 ─────────────────────────────────────────────────────────
    var state = {
      phase: "idle",
      error: null,
      store: { version: 1, notes: [], settings: { hoverCount: 10, hoverEnabled: true, defaultView: "grouped" } },
      lastInput: null,
      toasts: [],
      toastSeq: 0,
      hover: { open: false, top: 0, left: 0, workspaceTitle: null, rows: [] },
      hoverCompose: null,
      view: null,
      query: "",
      modal: null,
      tab: "notes",
      draft: null,
    };
    var listeners = [];
    /** 存储快照的单调序号：并发请求按发出顺序取号，只有更新的那份可以覆盖本地状态。 */
    var storeSeq = 0;

    /** 缺失的 hooks 用不订阅的空实现代替，保证 hook 调用顺序恒定。 */
    function useMaybe(hook) {
      return typeof hook === "function" ? hook : function () { return undefined; };
    }

    // 图标与浮层是两个组件，各自持有计时器：共用会让「延迟关闭」被「延迟打开」清掉。
    var anchorTimer = 0;
    var cardTimer = 0;
    /** 统一的延迟收起：图标离开与浮层离开都走它，避免两条路径各自维护计时器。 */
    function scheduleHoverClose() {
      // 正在浮层里写便签时不自动收起：写到一半被计时器吞掉是灾难。
      if (state.hoverCompose !== null) return;
      if (cardTimer) clearTimeout(cardTimer);
      cardTimer = setTimeout(function () { cardTimer = 0; closeHover(); }, 320);
    }

    var HOVER_CLOSED = { open: false, top: 0, left: 0, workspaceTitle: null, rows: [] };
    function closeHover() {
      if (!state.hover.open && state.hoverCompose === null) return;
      var interrupted = state.hoverCompose !== null && String(state.hoverCompose.text).trim() !== "";
      state.hover = HOVER_CLOSED;
      // 正在写的便签不能因为浮层收起就丢掉：收起后转到详情页继续写。
      state.hoverCompose = null;
      if (interrupted) toast(t("composeDropped"));
      emit();
    }

    /**
     * 订阅者能看到的状态切片。
     *
     * 用字段清单生成而不是手抄对象：加一个状态字段时只需要在 SNAPSHOT_KEYS
     * 里加一项，不会再出现「state 有、快照没有」的静默漏字段。
     * toasts 必须复制数组（订阅者可能持有旧快照）。
     */
    var SNAPSHOT_KEYS = [
      "phase", "error", "store", "modal", "toasts", "hover", "hoverCompose",
      "view", "tab", "draft", "query", "lastInput",
    ];
    function snapshot() {
      var value = {};
      for (var index = 0; index < SNAPSHOT_KEYS.length; index += 1) {
        var key = SNAPSHOT_KEYS[index];
        value[key] = state[key];
      }
      value.toasts = state.toasts.slice();
      return value;
    }
    function emit() {
      var value = snapshot();
      for (var index = 0; index < listeners.length; index += 1) {
        try { listeners[index](value); } catch (error) { /* 单个订阅者抛错不阻断其余 */ }
      }
    }
    function subscribe(listener) {
      listeners.push(listener);
      return function () {
        var at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
    function useStore() {
      var pair = React.useState(snapshot);
      var setValue = pair[1];
      React.useEffect(function () { return subscribe(setValue); }, []);
      return pair[0];
    }

    // ── 数据通道 ─────────────────────────────────────────────────────────────
    function rpc(op, payload) {
      return fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload === undefined ? { op: op } : { op: op, payload: payload }),
      }).then(function (response) {
        return response.text().then(function (bodyText) {
          var parsed;
          try { parsed = JSON.parse(bodyText); } catch (error) { throw new Error("服务响应不是 JSON（HTTP " + response.status + "）"); }
          if (!response.ok || !parsed || parsed.ok !== true) {
            // host 回的是稳定错误码（中文 error 只作兜底展示）：前端按 code 查本地化文案，
            // 避免用「message 里含『相同』」这种中文文案耦合来判断错误类型。
            var failure = new Error((parsed && parsed.error) || ("请求失败（HTTP " + response.status + "）"));
            failure.code = parsed && typeof parsed.code === "string" ? parsed.code : "unknown";
            throw failure;
          }
          return parsed;
        });
      });
    }

    /** 新建便签：归属当前会话（拿不到就不带归属，展示时显示「未知」）。 */
    function addNote(text) {
      var last = state.lastInput;
      return rpc("add", {
        text: text,
        workspaceId: last && last.workspaceId ? last.workspaceId : null,
        sessionId: last && last.sessionId ? last.sessionId : null,
      });
    }

    /** 复制正文到剪贴板：navigator.clipboard 在非安全上下文里没有，退到 textarea + execCommand。 */
    /**
     * 把一次失败的 rpc 呈现成一句本地化提示。
     *
     * 优先按 host 给的稳定 code 查文案；没有 code 或 code 未知时退回 host 的中文原文
     * （那是最后一道兜底，不是判断依据）。
     * @param {unknown} error
     * @returns {string}
     */
    function describeError(error) {
      var code = error && typeof error.code === "string" ? error.code : "";
      if (code === "duplicate") return t("duplicate");
      if (code === "empty") return t("draftEmpty");
      if (code === "full") return t("storeFull");
      if (code === "missing") return t("noteMissing");
      if (code === "invalid") return t("undoFailed");
      return error && error.message ? error.message : String(error);
    }

    function copyText(text) {
      var done = false;
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(text).catch(function () { /* 失败静默，下面走同步兜底 */ });
          done = true;
        }
      } catch (error) { done = false; }
      if (!done) {
        try {
          var area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          done = document.execCommand("copy") === true;
          document.body.removeChild(area);
        } catch (error) { done = false; }
      }
      toast(done ? t("copied") : t("copyBlocked"));
      return done;
    }

    /**
     * 采纳一份来自 host 的存储快照。
     *
     * 并发请求（首屏 load 与一次 add/remove）回来的顺序不保证：
     * 旧响应后到会把新数据盖回去。用一个单调递增的序号取大者，只接受更新的那份。
     * @param {object} store
     * @param {number} [seq] 请求发出时取的序号；缺省表示「一定采纳」（本地构造）
     */
    function applyStore(store, seq) {
      if (!store || !Array.isArray(store.notes)) return;
      if (typeof seq === "number") {
        if (seq < storeSeq) return;
        storeSeq = seq;
      } else {
        storeSeq += 1;
      }
      state.store = store;
      emit();
    }

    function nextStoreSeq() {
      storeSeq += 1;
      return storeSeq;
    }

    function load() {
      if (state.phase === "loading" || state.phase === "ready") return;
      state.phase = "loading";
      state.error = null;
      emit();
      var seq = nextStoreSeq();
      rpc("state").then(function (result) {
        state.phase = "ready";
        // 首屏响应可能晚于一次已完成的 add/remove：那样它已经过期，不能覆盖。
        if (seq >= storeSeq) {
          storeSeq = seq;
          state.store = result.store;
        }
        emit();
      }).catch(function (error) {
        state.phase = "error";
        state.error = error && error.message ? error.message : String(error);
        emit();
      });
    }

    function toast(text, undo) {
      state.toastSeq += 1;
      var entry = { id: state.toastSeq, text: text, undo: undo || null, timer: 0 };
      entry.timer = setTimeout(function () { dismissToast(entry.id, false); }, 5000);
      state.toasts = state.toasts.concat([entry]);
      emit();
      return entry;
    }
    function dismissToast(id, run) {
      var entry = null;
      state.toasts = state.toasts.filter(function (candidate) {
        if (candidate.id === id) { entry = candidate; return false; }
        return true;
      });
      if (entry && entry.timer) clearTimeout(entry.timer);
      emit();
      if (run && entry && typeof entry.undo === "function") entry.undo();
    }

    // ── 纯展示工具 ───────────────────────────────────────────────────────────
    var RE_FENCE = new RegExp(FENCE + "[\\s\\S]*?" + FENCE, "g");
    var RE_CODE = new RegExp(BT + "([^" + BT + "]*)" + BT, "g");

    function plainText(text) {
      return String(text)
        .replace(RE_FENCE, " ")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+[.)]\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(RE_CODE, "$1")
        .replace(/\*\*([^*]*)\*\*/g, "$1")
        .replace(/\*([^*]*)\*/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/~~([^~]*)~~/g, "$1")
        .replace(/[ \t]+/g, " ")
        .trim();
    }

    function contentKey(text) {
      return typeof text === "string" ? text.replace(/\s+/g, "").toLowerCase() : "";
    }

    function sortedNotes(notes) {
      return notes.slice().sort(function (left, right) {
        return String(right.createdAt).localeCompare(String(left.createdAt));
      });
    }

    function workspaceOf(workspaces, workspaceId) {
      if (!workspaces || !Array.isArray(workspaces.items) || !workspaceId) return undefined;
      for (var index = 0; index < workspaces.items.length; index += 1) {
        if (workspaces.items[index].workspaceId === workspaceId) return workspaces.items[index];
      }
      return undefined;
    }

    function workspaceOfSession(workspaces, sessionId) {
      if (!workspaces || !Array.isArray(workspaces.items) || !sessionId) return undefined;
      for (var index = 0; index < workspaces.items.length; index += 1) {
        var item = workspaces.items[index];
        if (Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) >= 0) return item;
      }
      return undefined;
    }

    function sessionTitle(sessions, sessionId) {
      if (!sessions || !sessions.byId || !sessionId) return null;
      var row = sessions.byId[sessionId];
      if (!row) return null;
      return row.displayTitle || row.title || null;
    }

    /** 从 chat 快照里按 messageId 找这条回答的正文。 */
    function textOfMessage(chat, messageId) {
      if (!chat || !messageId) return null;
      var order = chat.order || [];
      for (var index = order.length - 1; index >= 0; index -= 1) {
        var node = chat.nodes.get(order[index]);
        if (!node || node.kind !== "assistant-step") continue;
        var data = node.data;
        if (!data || !data.finalNode || data.finalNode.messageId !== messageId) continue;
        var text = (data.blocks || []).map(function (block) {
          return block && block.kind === "text" ? block.text : "";
        }).join("");
        if (text.trim() === "") return null;
        return text;
      }
      return null;
    }

    /** 把便签正文追加到输入框末尾；失败时依次退化。 */
    function sendToInput(text) {
      var last = state.lastInput;
      if (!last || !last.actions) { toast(t("noSession")); return false; }
      var actions = last.actions;
      var draft = typeof last.draft === "string" ? last.draft : "";
      var payload = draft.trim() === "" ? text : "\n\n" + text;
      var accepted = false;
      try {
        accepted = actions.insertText(payload, { start: draft.length, end: draft.length, draftRev: last.draftRev }) === true;
      } catch (error) { accepted = false; }
      if (!accepted) {
        try { accepted = actions.insertText(payload, actions.captureInsertion()) === true; } catch (error) { accepted = false; }
      }
      if (!accepted) {
        try {
          actions.setDraft(draft.trim() === "" ? text : draft + "\n\n" + text);
          accepted = true;
        } catch (error) { accepted = false; }
      }
      toast(accepted ? t("sent") : t("sendBlocked"));
      if (!accepted) {
        // 桌面端「传送到输入框」失败时退回复制，至少不让内容卡死在这里
        return false;
      }
      state.lastInput = {
        sessionId: last.sessionId,
        workspaceId: last.workspaceId,
        draft: draft.trim() === "" ? text : draft + "\n\n" + text,
        draftRev: last.draftRev,
        actions: last.actions,
      };
      return true;
    }

    // ── 图标 ─────────────────────────────────────────────────────────────────
    function svg(children, props) {
      return h("svg", Object.assign({
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
      }, props || {}), children);
    }
    function IconBookmark(props) {
      return svg(h("path", { d: "M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.2L5.5 20V5a1 1 0 0 1 1-1z", fill: props && props.filled ? "currentColor" : "none" }));
    }
    function IconSend() {
      return svg([h("path", { key: "a", d: "M5 12h13" }), h("path", { key: "b", d: "M12.5 5.5 19 12l-6.5 6.5" })]);
    }
    function IconPencil() {
      return svg([h("path", { key: "a", d: "M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" }), h("path", { key: "b", d: "M13.5 6.5l4 4" })]);
    }
    function IconTrash() {
      return svg([
        h("path", { key: "a", d: "M4.5 6.5h15" }),
        h("path", { key: "b", d: "M9.5 6.5V4.6c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1v1.9" }),
        h("path", { key: "c", d: "M6.5 6.5l.8 12.2c.05.9.8 1.6 1.7 1.6h6c.9 0 1.65-.7 1.7-1.6l.8-12.2" }),
      ]);
    }
    function IconBack() {
      return svg([h("path", { key: "a", d: "M19 12H6" }), h("path", { key: "b", d: "M11.5 5.5 6 12l5.5 6.5" })]);
    }
    function IconSearch() {
      return svg([h("circle", { key: "a", cx: 11, cy: 11, r: 6 }), h("path", { key: "b", d: "M15.5 15.5 20 20" })]);
    }
    function IconNote(props) {
      var size = props && props.size ? props.size : 20;
      return svg([
        h("path", { key: "a", d: "M5 4.5A1.5 1.5 0 0 1 6.5 3H17a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A1.5 1.5 0 0 1 5 19.5z" }),
        h("path", { key: "b", d: "M8.5 8h7M8.5 12h7M8.5 16h4" }),
      ], { width: size, height: size });
    }

    // ── 收藏按钮（conversation.chat.assistant-actions）───────────────────────
    function BookmarkAction(props) {
      var messageId = props.messageId;
      var sessionId = props.sessionId;
      var inputActions = props.inputActions;
      var useChat = props.useChat;
      var useWorkspaces = props.useWorkspaces;
      var useInput = props.useInput;

      // hooks 必须无条件按固定顺序调用：props 缺某个 hook 时用不订阅的空实现兜底，
      // 而不是条件调用（那会在两次渲染间改变 hook 数量并直接崩溃）。
      var text = useMaybe(useChat)(function (value) { return textOfMessage(value, messageId); });
      var workspaceId = useMaybe(useWorkspaces)(function (value) {
        // hook 缺失时 useMaybe 的选择器会收到 undefined：这里必须守住，
        // 否则整条回复的收藏按钮渲染期抛错，整条消息的 action 行都崩。
        var items = value && Array.isArray(value.items) ? value.items : [];
        for (var index = 0; index < items.length; index += 1) {
          var item = items[index];
          if (item && Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) >= 0) return item.workspaceId || null;
        }
        return null;
      });
      // 两个原始值订阅：整份 InputState 每次按键都是新对象，会让每条回复的按钮都重渲染。
      var draft = useMaybe(useInput)(function (value) {
        return typeof value.draft === "string" ? value.draft : "";
      });
      var draftRev = useMaybe(useInput)(function (value) {
        return typeof value.draftRev === "number" ? value.draftRev : 0;
      });
      var view = useStore();

      React.useEffect(function () {
        var previous = state.lastInput;
        var same = previous !== null
          && previous.sessionId === sessionId
          && previous.workspaceId === workspaceId
          && previous.draft === draft
          && previous.draftRev === draftRev
          && previous.actions === inputActions;
        state.lastInput = { sessionId: sessionId, workspaceId: workspaceId, draft: draft, draftRev: draftRev, actions: inputActions || null };
        // 草稿每次按键都变，但只有归属会话/工作区/输入框句柄变化才值得通知全量订阅者
        if (!same) emit();
      }, [sessionId, workspaceId, draft, draftRev, inputActions]);

      React.useEffect(function () { load(); }, []);

      var notes = view.store.notes;
      if (text === undefined) text = null;
      var key = text === null ? null : contentKey(text);
      var existing = null;
      if (key !== null) {
        for (var index = 0; index < notes.length; index += 1) {
          if (contentKey(notes[index].text) === key) { existing = notes[index]; break; }
        }
      }
      var saved = existing !== null;
      var disabled = text === null;

      var onClick = function () {
        if (text === null) return;
        if (existing !== null) {
          var removed = existing;
          var removedIndex = view.store.notes.findIndex(function (note) { return note.id === removed.id; });
          var removeSeq = nextStoreSeq();
          rpc("remove", { id: removed.id }).then(function (result) {
            applyStore(result.store, removeSeq);
            toast(t("deleted"), function () {
              var undoSeq = nextStoreSeq();
              rpc("restore", { note: removed, index: removedIndex < 0 ? 0 : removedIndex })
                .then(function (restored) { applyStore(restored.store, undoSeq); })
                .catch(function (error) { toast(error.message || t("undoFailed")); });
            });
          }).catch(function (error) { toast(error.message); });
          return;
        }
        var addSeq = nextStoreSeq();
        rpc("add", { text: text, workspaceId: workspaceId, sessionId: sessionId })
          .then(function (result) {
            applyStore(result.store, addSeq);
            if (result.added === true) toast(t("savedToast"));
          })
          .catch(function (error) { toast(error.message); });
      };

      var label = disabled ? t("cannot") : (saved ? t("saved") : t("saveAction"));
      // 与同一行里宿主自己的 copy / branch / like 按钮同尺寸同色（宿主用 28px + 字号增量）。
      return h("button", {
        type: "button",
        className: "dnt-hact",
        title: label,
        "aria-label": label,
        "aria-pressed": saved,
        disabled: disabled,
        onClick: onClick,
      }, h(IconBookmark, { filled: saved }));
    }

    // ── 左栏图标（sidebar.panellist）：图标 + hover 计时器 ───────────────────
    // 浮层本身注册在 shell.overlay 上渲染，才能摆脱侧栏容器的 overflow/transform 裁剪。
    function SidebarEntry(props) {
      var size = props.size || 20;
      var active = props.active === true;
      var useWorkspaces = props.useWorkspaces;
      var useSessions = props.useSessions;
      var view = useStore();

      var workspaces = useMaybe(useWorkspaces)(function (value) { return value; });
      var sessions = useMaybe(useSessions)(function (value) { return value; });

      var anchorRef = React.useRef(null);

      React.useEffect(function () { load(); }, []);
      React.useEffect(function () {
        return function () {
          // 图标卸载（面板收起、导航切换）：待打开的计时器与浮层一起清掉，否则浮层会悬空留着
          if (anchorTimer) { clearTimeout(anchorTimer); anchorTimer = 0; }
          closeHover();
        };
      }, []);

      var settings = view.store.settings;
      var currentSessionId = view.lastInput ? view.lastInput.sessionId : null;
      var currentWorkspace = workspaceOfSession(workspaces, currentSessionId);
      var all = sortedNotes(view.store.notes);
      var scoped = currentWorkspace
        ? all.filter(function (note) { return note.workspaceId === currentWorkspace.workspaceId; })
        : all;
      var rows = scoped.slice(0, settings.hoverCount);

      /** 便签 → 浮层行。打开时与打开期间刷新共用，改字段只需改这一处。 */
      var hoverRows = function () {
        return rows.map(function (note) {
          return {
            id: note.id,
            text: plainText(note.text),
            source: sessionTitle(sessions, note.sessionId) || t("unknownSession"),
            raw: note.text,
          };
        });
      };

      var openCard = function () {
        if (!settings.hoverEnabled) return;
        var rect = anchorRef.current ? anchorRef.current.getBoundingClientRect() : null;
        var top = rect ? Math.max(8, Math.min(rect.top, window.innerHeight - 360)) : 8;
        var left = rect ? Math.min(rect.right + 10, Math.max(8, window.innerWidth - 372)) : 66;
        state.hover = {
          open: true,
          top: top,
          left: left,
          workspaceTitle: currentWorkspace ? currentWorkspace.title : null,
          rows: hoverRows(),
        };
        emit();
      };
      React.useEffect(function () {
        // 浮层打开期间数据变了要跟着刷新，否则显示的是打开那一刻的快照
        if (!view.hover.open) return;
        var nextRows = hoverRows();
        var previous = view.hover.rows;
        var same = previous.length === nextRows.length && previous.every(function (row, index) {
          return row.id === nextRows[index].id && row.text === nextRows[index].text;
        });
        if (same) return;
        state.hover = {
          open: true,
          top: view.hover.top,
          left: view.hover.left,
          workspaceTitle: currentWorkspace ? currentWorkspace.title : null,
          rows: nextRows,
        };
        emit();
      }, [view.hover.open, view.hover.rows, view.store.notes, workspaces, sessions, settings.hoverCount]);

      var onEnter = function () {
        if (!settings.hoverEnabled) return;
        if (anchorTimer) clearTimeout(anchorTimer);
        anchorTimer = setTimeout(function () { anchorTimer = 0; openCard(); }, 260);
      };
      var onLeave = function () {
        // 离开图标只是取消「待打开」；浮层自己的 320ms 关闭计时器负责收起，
        // 这样指针从图标移到浮层时不会被立刻关掉。
        if (anchorTimer) { clearTimeout(anchorTimer); anchorTimer = 0; }
        // 但浮层已经打开时，指针可能根本没进过浮层（横穿别处离开）：
        // 那种情况下浮层的 onPointerLeave 永远不会触发，必须在这里补一次延迟关闭。
        if (state.hover.open) scheduleHoverClose();
      };
      // 外壳（PanelIcon 的父 button）已经拥有按钮语义与点击切换；
      // 这里只渲染图标内容，避免 button 嵌套 button。键盘焦点落在外壳 button 上，
      // 所以用 focusin/focusout 冒泡事件接管（span 自身不会收到 focus）。
      return h("span", {
        ref: anchorRef,
        className: "dnt-rail",
        "data-active": active,
        onPointerEnter: onEnter,
        onPointerLeave: onLeave,
        onFocus: onEnter,
        onBlur: onLeave,
      }, h(IconNote, { size: size }), view.store.notes.length > 0
        ? h("span", { className: "dnt-cnt" }, view.store.notes.length > 99 ? "99+" : String(view.store.notes.length))
        : null);
    }

    // ── hover 浮层（shell.overlay）───────────────────────────────────────────
    function HoverCardLayer() {
      var view = useStore();
      var hover = view.hover;

      React.useEffect(function () {
        return function () {
          if (cardTimer) { clearTimeout(cardTimer); cardTimer = 0; }
        };
      }, []);

      React.useEffect(function () {
        if (!hover.open) return undefined;
        // 打开态：Esc 收起，焦点不进入浮层就不会形成键盘陷阱（浮层内按钮仍可 Tab 到）
        var onKey = function (event) {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          // Esc 的语义是「退一层」：先收输入区，再收整个浮层。
          if (state.hoverCompose !== null) {
            state.hoverCompose = null;
            emit();
            return;
          }
          closeHover();
        };
        document.addEventListener('keydown', onKey);
        return function () { document.removeEventListener('keydown', onKey); };
      }, [hover.open]);

      var compose = view.hoverCompose;
      var saveCompose = function () {
        var pending = compose;
        if (pending === null) return;
        var text = String(pending.text);
        if (text.trim() === "") { toast(t("draftEmpty")); return; }
        var composeSeq = nextStoreSeq();
        addNote(text).then(function (result) {
          applyStore(result.store, composeSeq);
          state.hoverCompose = null;
          emit();
        }).catch(function (error) {
          toast(describeError(error));
        });
      };

      var keepOpen = function () {
        if (cardTimer) { clearTimeout(cardTimer); cardTimer = 0; }
      };
      var scheduleClose = scheduleHoverClose;
      var openPanel = function () {
        var layout = openPanelTarget();
        if (layout && typeof layout.selectPanel === "function") {
          try { layout.selectPanel(PANEL_ID); } catch (error) { /* main 尚未注册时静默忽略 */ }
        }
        closeHover();
      };

      // 未打开时整块不渲染：aria-hidden 容器里的可聚焦按钮依然会被 Tab 命中。
      if (!hover.open) return null;

      return h("div", {
        className: "dnt-hover dnt-root",
        "data-open": true,
        role: "dialog",
        "aria-label": t("hoverTitle"),
        style: { top: hover.top, left: hover.left },
        onPointerEnter: keepOpen,
        onPointerLeave: scheduleClose,
      },
        h("div", { className: "dnt-hc-head" },
          h("span", { className: "dnt-hc-h" }, t("hoverTitle")),
          h("span", { className: "dnt-hc-ws" }, hover.workspaceTitle || t("unknownWs")),
          h("button", {
            type: "button",
            className: "dnt-hc-add",
            title: t("hoverAdd"),
            "aria-label": t("hoverAdd"),
            "aria-expanded": compose !== null,
            onClick: function () {
              state.hoverCompose = compose === null ? { text: "" } : null;
              emit();
            },
          }, h(IconPlus, null))),
        compose === null ? null : h("div", { className: "dnt-hc-compose" },
          h("textarea", {
            // 浮层里就地新建：写的是同一条 add 通道，归属当前工作区与会话。
            autoFocus: true,
            spellCheck: false,
            value: compose.text,
            placeholder: t("draftPlaceholder"),
            "aria-label": t("draftTitle"),
            onChange: function (event) {
              state.hoverCompose = { text: event.target.value };
              emit();
            },
            onKeyDown: function (event) {
              if (event.key === "Escape") {
                event.preventDefault();
                state.hoverCompose = null;
                emit();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                saveCompose();
              }
            },
          }),
          h("div", { className: "dnt-hc-compose-row" },
            h("span", { className: "dnt-hc-hint" }, "⌘/Ctrl + Enter"),
            h("button", { type: "button", className: "dnt-btn", onClick: function () {
              state.hoverCompose = null;
              emit();
            } }, t("cancel")),
            h("button", { type: "button", className: "dnt-btn dnt-primary", onClick: saveCompose }, t("save")))),
        hover.rows.length === 0
          ? h("div", { className: "dnt-hc-empty" }, t("hoverEmpty"))
          : h("div", { className: "dnt-hc-scroll" }, hover.rows.map(function (row) {
            // 每行只有正文两行 + 右侧两个动作（传送 / 复制），不带来源小字。
            return h("div", { className: "dnt-hc-row", key: row.id },
              h("p", { className: "dnt-hc-t", title: row.text }, row.text),
              h("div", { className: "dnt-hc-acts" },
                h("button", {
                  type: "button",
                  className: "dnt-hc-go",
                  title: t("send"),
                  "aria-label": t("send"),
                  onClick: function () { sendToInput(row.raw); closeHover(); },
                }, h(IconSend, null)),
                h("button", {
                  type: "button",
                  className: "dnt-hc-go",
                  title: t("copy"),
                  "aria-label": t("copy"),
                  onClick: function () { copyText(row.raw); },
                }, h(IconCopy, null))));
          })),
        h("div", { className: "dnt-hc-foot" },
          h("button", { type: "button", className: "dnt-hc-all", onClick: openPanel },
            h("span", null, t("hoverAll")), h("span", null, "→"))));
    }

    // ── 便签卡片 ─────────────────────────────────────────────────────────────
    function NoteCard(props) {
      var note = props.note;
      var full = plainText(note.text);
      var shortened = full.length > 400 ? full.slice(0, 400) + "…" : full;
      // 卡片只做摘要：全文预览与编辑都在弹窗里（弹窗才装得下块级 Markdown）。
      return h("article", { className: "dnt-note" },
        h("p", {
          className: "dnt-body",
          title: t("openPreview"),
          onClick: function () { props.onOpen(note.id, "preview"); },
        }, shortened),
        h("div", { className: "dnt-foot" },
          h("span", { className: "dnt-src", title: props.source }, props.source),
          h("div", { className: "dnt-acts" },
            h("button", { type: "button", className: "dnt-act", title: t("send"), "aria-label": t("send"), onClick: function () { props.onSend(note); } }, h(IconSend, null)),
            h("button", { type: "button", className: "dnt-act", title: t("copy"), "aria-label": t("copy"), onClick: function () { copyText(note.text); } }, h(IconCopy, null)),
            h("button", { type: "button", className: "dnt-act", title: t("edit"), "aria-label": t("edit"), onClick: function () { props.onOpen(note.id, "edit"); } }, h(IconPencil, null)),
            h("button", { type: "button", className: "dnt-act dnt-danger", title: t("del"), "aria-label": t("del"), onClick: function () { props.onDelete(note); } }, h(IconTrash, null)))));
    }

    function IconCopy() {
      return svg([
        h("rect", { key: "a", x: "9", y: "9", width: "11", height: "11", rx: "2" }),
        h("path", { key: "b", d: "M6.5 15H5.5A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v1" }),
      ]);
    }

    function IconPlus() {
      return svg([h("path", { key: "a", d: "M12 5v14" }), h("path", { key: "b", d: "M5 12h14" })]);
    }

    // ── 便签弹窗：预览全文 / 编辑正文（shell.overlay）─────────────────────────
    function NoteModal() {
      var view = useStore();
      var modal = view.modal;
      var textareaRef = React.useRef(null);

      React.useEffect(function () {
        if (modal === null) return undefined;
        var onKey = function (event) {
          if (event.key !== "Escape") return;
          event.preventDefault();
          closeModal();
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [modal === null ? "" : modal.id, modal === null ? "" : modal.mode]);

      React.useEffect(function () {
        if (modal !== null && modal.mode === "edit" && textareaRef.current) textareaRef.current.focus();
      }, [modal === null ? "" : modal.id, modal === null ? "" : modal.mode]);

      if (modal === null) return null;
      var note = null;
      for (var index = 0; index < view.store.notes.length; index += 1) {
        if (view.store.notes[index].id === modal.id) { note = view.store.notes[index]; break; }
      }
      if (note === null) return null;
      var editing = modal.mode === "edit";

      var save = function () {
        var text = textareaRef.current ? textareaRef.current.value : note.text;
        var modalSaveSeq = nextStoreSeq();
        rpc("update", { id: note.id, text: text }).then(function (result) {
          applyStore(result.store, modalSaveSeq);
          state.modal = null;
          emit();
        }).catch(function (error) {
          toast(describeError(error));
        });
      };

      return h("div", {
        className: "dnt-modal dnt-root",
        role: "presentation",
        onMouseDown: function (event) {
          // 只有点在遮罩本身才关；点在弹窗内部不关。
          if (event.target === event.currentTarget) closeModal();
        },
      },
        h("div", {
          className: "dnt-modal-box",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": editing ? t("editTitle") : t("previewTitle"),
        },
          h("div", { className: "dnt-modal-head" },
            h("span", { className: "dnt-modal-title" }, editing ? t("editTitle") : t("previewTitle")),
            h("button", {
              type: "button",
              className: "dnt-modal-x",
              title: t("close"),
              "aria-label": t("close"),
              onClick: closeModal,
            }, "✕")),
          h("div", { className: "dnt-modal-body" },
            editing
              ? h("textarea", { ref: textareaRef, className: "dnt-modal-area", defaultValue: note.text, spellCheck: false })
              : (MarkdownText === null
                ? h("pre", { className: "dnt-md-fallback" }, note.text)
                : h(MarkdownText, { text: note.text, labels: MD_LABELS, variant: "body" }))),
          h("div", { className: "dnt-modal-foot" },
            editing
              ? [
                h("button", { type: "button", key: "cancel", className: "dnt-btn", onClick: closeModal }, t("cancel")),
                h("button", { type: "button", key: "save", className: "dnt-btn dnt-primary", onClick: save }, t("save")),
              ]
              : [
                h("button", { type: "button", key: "copy", className: "dnt-btn", onClick: function () { copyText(note.text); } },
                  h(IconCopy, null), t("copy")),
                h("button", { type: "button", key: "edit", className: "dnt-btn", onClick: function () {
                  state.modal = { id: note.id, mode: "edit" };
                  emit();
                } }, h(IconPencil, null), t("edit")),
                h("button", { type: "button", key: "send", className: "dnt-btn dnt-primary", onClick: function () {
                  var sent = sendToInput(note.text);
                  state.modal = null;
                  emit();
                  if (sent) backToConversation();
                } }, h(IconSend, null), t("send")),
              ])));
    }

    // ── 新建便签草稿卡 ───────────────────────────────────────────────────────
    function DraftCard(props) {
      var draft = props.draft;
      var textareaRef = React.useRef(null);

      React.useEffect(function () {
        if (textareaRef.current) textareaRef.current.focus();
      }, []);

      return h("article", { className: "dnt-note", "data-editing": true },
        h("div", { className: "dnt-edit" },
          h("div", { className: "dnt-edit-label" }, t("draftTitle")),
          h("textarea", {
            ref: textareaRef,
            spellCheck: false,
            placeholder: t("draftPlaceholder"),
            "aria-label": t("draftTitle"),
            value: draft.text,
            onChange: function (event) { props.onChange(event.target.value); },
            onKeyDown: function (event) {
              if (event.key === "Escape") { event.preventDefault(); props.onCancel(); }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                props.onSave();
              }
            },
          }),
          h("div", { className: "dnt-row" },
            h("button", { type: "button", className: "dnt-btn", onClick: props.onCancel }, t("cancel")),
            h("button", { type: "button", className: "dnt-btn dnt-primary", onClick: props.onSave }, t("save")))));
    }

    // ── 详情页（main）────────────────────────────────────────────────────────
    function NotesPanel(props) {
      var useWorkspaces = props.useWorkspaces;
      var useSessions = props.useSessions;
      var view = useStore();

      React.useEffect(function () { load(); }, []);

      var workspaces = useMaybe(useWorkspaces)(function (value) { return value; });
      var sessions = useMaybe(useSessions)(function (value) { return value; });

      var query = view.query;
      var mode = view.view || view.store.settings.defaultView || "grouped";
      var all = sortedNotes(view.store.notes).filter(function (note) {
        if (query.trim() === "") return true;
        return plainText(note.text).toLowerCase().indexOf(query.trim().toLowerCase()) >= 0;
      });

      var onDelete = function (note) {
        var index = view.store.notes.findIndex(function (candidate) { return candidate.id === note.id; });
        var pageDelSeq = nextStoreSeq();
        rpc("remove", { id: note.id }).then(function (result) {
          applyStore(result.store, pageDelSeq);
          toast(t("deleted"), function () {
            var undoSeq = nextStoreSeq();
            rpc("restore", { note: note, index: index < 0 ? 0 : index })
              .then(function (restored) { applyStore(restored.store, undoSeq); })
              // 撤销失败要在界面上说清楚，不能只在 console 里留痕
              .catch(function (error) { toast(error.message || t("undoFailed")); });
          });
        }).catch(function (error) { toast(error.message); });
      };
      // 详情页的「传送到输入框」：发送等于「回去写」，所以插完直接回到会话。
      // 浮层里的发送仍留在原处（那里用户还在连看几条）。
      var onSend = function (note) {
        var sent = sendToInput(note.text);
        if (sent) backToConversation();
      };
      var newNote = function () {
        state.draft = { text: "" };
        state.tab = "notes";
        emit();
      };
      var saveDraft = function () {
        var draft = state.draft;
        if (draft === null) return;
        var text = String(draft.text);
        if (text.trim() === "") { toast(t("draftEmpty")); return; }
        // 先收起草稿卡，避免保存失败时表单消失
        var pending = draft;
        state.draft = null;
        emit();
        var draftSeq = nextStoreSeq();
        addNote(text).then(function (result) {
          applyStore(result.store, draftSeq);
          emit();
        }).catch(function (error) {
          state.draft = pending;
          emit();
          toast(describeError(error));
        });
      };
      var cancelDraft = function () { state.draft = null; emit(); };
      var onOpen = function (id, mode) { state.modal = { id: id, mode: mode || "preview" }; emit(); };

      var groups = [];
      if (mode === "grouped") {
        var byWorkspace = new Map();
        all.forEach(function (note) {
          var key = note.workspaceId || "";
          if (!byWorkspace.has(key)) byWorkspace.set(key, []);
          byWorkspace.get(key).push(note);
        });
        byWorkspace.forEach(function (notes, key) {
          var workspace = workspaceOf(workspaces, key);
          groups.push({ key: key || "none", title: workspace ? workspace.title : t("unknownWs"), notes: notes });
        });
      } else {
        groups.push({ key: "all", title: null, notes: all });
      }

      var renderCard = function (note) {
        // 卡片底部只放会话名（Q6c）：分组视图下工作区名已是分组头，平铺时也不是必要信息
        var title = sessionTitle(sessions, note.sessionId) || t("unknownSession");
        return h(NoteCard, {
          key: note.id,
          note: note,
          source: title,
          onOpen: onOpen,
          onDelete: onDelete,
          onSend: onSend,
        });
      };

      var tab = view.tab === "settings" ? "settings" : "notes";
      var setTab = function (next) {
        state.tab = next;
        emit();
      };

      return h("div", { className: "dnt-page dnt-root" },
        h("div", { className: "dnt-page-in" },
          h("div", { className: "dnt-head" },
            h("button", {
              type: "button",
              className: "dnt-back",
              onClick: backToConversation,
              title: t("back"),
              "aria-label": t("back"),
            }, h(IconBack, null)),
            h("div", { className: "dnt-head-main" },
              h("h1", { className: "dnt-title" }, t("title")),
              h("span", { className: "dnt-count" }, t("countUnit", view.store.notes.length))),
            h("button", {
              type: "button",
              className: "dnt-new",
              onClick: newNote,
              title: t("newNoteHint"),
            }, h(IconPlus, null), t("newNote"))),
          h("div", { className: "dnt-tabs", role: "tablist" },
            h("button", {
              type: "button", role: "tab", className: "dnt-tab",
              "aria-selected": tab === "notes",
              onClick: function () { setTab("notes"); },
            }, t("tabNotes")),
            h("button", {
              type: "button", role: "tab", className: "dnt-tab",
              "aria-selected": tab === "settings",
              onClick: function () { setTab("settings"); },
            }, t("tabSettings"))),
          tab === "settings"
            ? h(SettingsBody, { sessions: sessions })
            : h("div", null,
              h("p", { className: "dnt-sub" }, t("pageSub")),
              h("div", { className: "dnt-tool" },
                h("label", { className: "dnt-search" },
                  h(IconSearch, null),
                  h("input", {
                    type: "search",
                    value: query,
                    placeholder: t("search"),
                    "aria-label": t("search"),
                    onChange: function (event) { state.query = event.target.value; emit(); },
                  })),
                h("div", { className: "dnt-seg", role: "group", "aria-label": t("defaultView") },
                  h("button", {
                    type: "button", "aria-pressed": mode === "grouped",
                    onClick: function () { state.view = "grouped"; emit(); },
                  }, t("grouped")),
                  h("button", {
                    type: "button", "aria-pressed": mode === "flat",
                    onClick: function () { state.view = "flat"; emit(); },
                  }, t("flat")))),
              view.phase === "loading" ? h("div", { className: "dnt-empty" }, h("div", { className: "dnt-e-d" }, "…")) : null,
              view.phase === "error"
                ? h("div", { className: "dnt-empty" },
                  h("div", { className: "dnt-e-t" }, "⚠"),
                  h("div", { className: "dnt-e-d" }, view.error || ""),
                  h("button", {
                    type: "button",
                    className: "dnt-btn",
                    style: { marginTop: "12px" },
                    onClick: function () {
                      state.phase = "idle";
                      state.error = null;
                      emit();
                      load();
                    },
                  }, t("retry")))
                : null,
              view.draft !== null
                ? h("div", { className: "dnt-grid", style: { marginBottom: "12px" } },
                  h(DraftCard, {
                    key: "draft",
                    draft: view.draft,
                    onChange: function (text) { if (state.draft !== null) { state.draft.text = text; emit(); } },
                    onSave: saveDraft,
                    onCancel: cancelDraft,
                  }))
                : null,
              all.length === 0 && view.phase === "ready"
                ? (query.trim() !== ""
                  ? h("div", { className: "dnt-empty" },
                    h("div", { className: "dnt-e-t" }, t("noMatch")),
                    h("div", { className: "dnt-e-d" }, t("noMatchHint")))
                  : h("div", { className: "dnt-empty" },
                    h("div", { className: "dnt-e-t" }, t("empty")),
                    h("div", { className: "dnt-e-d" }, t("emptyHint")),
                    h("button", {
                      type: "button",
                      className: "dnt-new",
                      style: { marginTop: "16px" },
                      onClick: newNote,
                    }, h(IconPlus, null), t("newNote"))))
                : groups.map(function (group) {
                  return h("section", { className: "dnt-group", key: group.key },
                    group.title === null
                      ? null
                      : h("div", { className: "dnt-group-h" },
                        h("span", { className: "dnt-g-t" }, group.title),
                        h("span", { className: "dnt-g-n" }, String(group.notes.length))),
                    h("div", { className: "dnt-grid" }, group.notes.map(renderCard)));
                }))));
    }

    // ── 设置 tab（详情页内，不再占用 settings.section）────────────────────────
    function SettingsBody(props) {
      var view = useStore();
      var sessionsRef = props.sessions;
      React.useEffect(function () { load(); }, []);
      var settings = view.store.settings;

      var patch = function (next) {
        var settingsSeq = nextStoreSeq();
        rpc("settings", { patch: next })
          .then(function (result) { applyStore(result.store, settingsSeq); })
          .catch(function (error) { toast(error.message); });
      };

      var preview = sortedNotes(view.store.notes).slice(0, Math.min(3, settings.hoverCount));
      var first = preview[0];
      var previewSource = first
        ? (sessionTitle(sessionsRef, first.sessionId) || t("unknownSession"))
        : t("unknownSession");

      return h("div", { className: "dnt-root" },
        h("div", { className: "dnt-set" },
          h("div", null,
            h("p", { className: "dnt-s-sub" }, t("settingsSub")),
            h("div", { className: "dnt-srow" },
              h("div", { className: "dnt-s-l" },
                h("div", { className: "dnt-s-n" }, t("hoverCount")),
                h("div", { className: "dnt-s-d" }, t("hoverCountHint"))),
              h("input", {
                type: "number", min: 3, max: 30, step: 1,
                // 非受控：每次击键就提交会被 host 收敛（退格清空立刻变 3、输 1 变 3），
                // 改成 blur / Enter 时提交，中途允许非法中间态。
                defaultValue: settings.hoverCount,
                key: "hover-count-" + settings.hoverCount,
                "aria-label": t("hoverCount"),
                onBlur: function (event) {
                  var next = Number(event.target.value);
                  patch({ hoverCount: Number.isFinite(next) ? next : settings.hoverCount });
                },
                onKeyDown: function (event) {
                  if (event.key === "Enter") event.currentTarget.blur();
                },
              })),
            h("div", { className: "dnt-srow" },
              h("div", { className: "dnt-s-l" },
                h("div", { className: "dnt-s-n" }, t("hoverEnabled")),
                h("div", { className: "dnt-s-d" }, t("hoverEnabledHint"))),
              h("button", {
                type: "button",
                className: "dnt-sw",
                role: "switch",
                "aria-checked": settings.hoverEnabled,
                "aria-label": t("hoverEnabled"),
                onClick: function () { patch({ hoverEnabled: !settings.hoverEnabled }); },
              })),
            h("div", { className: "dnt-srow" },
              h("div", { className: "dnt-s-l" },
                h("div", { className: "dnt-s-n" }, t("defaultView")),
                h("div", { className: "dnt-s-d" }, t("defaultViewHint"))),
              h("select", {
                value: settings.defaultView,
                "aria-label": t("defaultView"),
                onChange: function (event) { patch({ defaultView: event.target.value }); },
              },
                h("option", { value: "grouped" }, t("grouped")),
                h("option", { value: "flat" }, t("flat"))))),
          h("div", { className: "dnt-pv" },
            h("div", { className: "dnt-pv-label" }, t("preview")),
            // 预览卡也吃 defaultView：分组视图下多一行工作区分组头，平铺视图下没有。
            h("div", { className: "dnt-pv-card", "data-view": settings.defaultView },
              settings.defaultView === "grouped"
                ? h("div", { className: "dnt-pv-group" }, previewSource === t("unknownSession") ? t("unknownWs") : previewSource)
                : null,
              h("p", { className: "dnt-body" }, preview.length > 0 ? plainText(preview[0].text).slice(0, 400) : t("emptyHint")),
              h("div", { className: "dnt-foot" },
                h("span", { className: "dnt-src" }, previewSource),
                h("div", { className: "dnt-acts" },
                  h("span", { className: "dnt-act" }, h(IconSend, null)),
                  h("span", { className: "dnt-act" }, h(IconCopy, null)),
                  h("span", { className: "dnt-act" }, h(IconPencil, null)),
                  h("span", { className: "dnt-act" }, h(IconTrash, null))))),
            h("div", { className: "dnt-pv-hover" + (settings.hoverEnabled ? "" : " dnt-pv-faded") },
              h("div", { className: "dnt-hc-head" },
                h("span", { className: "dnt-hc-h" }, t("hoverTitle")),
                h("span", { className: "dnt-hc-ws" }, t("unknownWs"))),
              preview.map(function (note) {
                return h("div", { className: "dnt-pv-r", key: note.id }, plainText(note.text));
              }),
              h("div", { className: "dnt-pv-foot" }, t("hoverAll") + (preview.length > 0 ? " · " + t("hoverCount") + " " + settings.hoverCount : ""))),
            h("div", { className: "dnt-pv-hint" }, [
              settings.hoverEnabled ? t("hoverCount") + " · " + settings.hoverCount : t("hoverEnabledHint"),
              t("defaultView") + " · " + (settings.defaultView === "flat" ? t("flat") : t("grouped")),
            ].join("　")))));
    }

    // ── Toast（shell.overlay）────────────────────────────────────────────────
    function ToastLayer() {
      var view = useStore();
      if (view.toasts.length === 0) return null;
      return h("div", { className: "dnt-toasts dnt-root" }, view.toasts.map(function (entry) {
        return h("div", { className: "dnt-toast", key: entry.id, role: "status" },
          h("span", null, entry.text),
          entry.undo === null ? null : h("button", {
            type: "button",
            onClick: function () { dismissToast(entry.id, true); },
          }, t("undo")),
          h("button", {
            type: "button",
            className: "dnt-toast-x",
            "aria-label": t("close"),
            title: t("close"),
            onClick: function () { dismissToast(entry.id, false); },
          }, "✕"));
      }));
    }

    // ── 插件入口 ─────────────────────────────────────────────────────────────
    var ctxRef = { ctx: null, layout: null, locale: null };

    /** 回到当前会话：main 槽传 null 即显示 Conversation（面板选择回到会话）。 */
    function closeModal() {
      if (state.modal === null) return;
      state.modal = null;
      emit();
    }

    function backToConversation() {
      var layout = openPanelTarget();
      if (layout && typeof layout.selectPanel === "function") {
        try { layout.selectPanel(null); return; } catch (error) { /* 面板尚未注册时退回下一种方式 */ }
      }
      if (ctxRef.ctx) {
        try {
          var uiWorkspace = ctxRef.ctx.get("uiWorkspace");
          if (uiWorkspace && typeof uiWorkspace.openSession === "function" && state.lastInput && state.lastInput.sessionId) {
            uiWorkspace.openSession({ sessionId: state.lastInput.sessionId });
          }
        } catch (error) { /* 无可用导航时保持原位 */ }
      }
    }

    /** layout 服务可能晚于本插件就绪，读取时现取一次，避免永久拿到 null。 */
    function openPanelTarget() {
      if (ctxRef.ctx) {
        try {
          var live = ctxRef.ctx.get("layout");
          if (live) return live;
        } catch (error) { /* 服务尚未就绪时退回 apply 期的快照 */ }
      }
      return ctxRef.layout;
    }

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (!slots) return;
      ctxRef.ctx = ctx;
      ctxRef.layout = ctx.get("layout") || null;
      ctxRef.locale = ctx.get("locale") || null;

      var locale = ctxRef.locale;
      if (locale && typeof locale.subscribe === "function") {
        var readLang = function () {
          try {
            var value = locale.getSnapshot();
            if (value && typeof value.active === "string") {
              lang = value.active;
              MD_LABELS = lang === "en" ? MD_LABELS_EN : MD_LABELS_ZH;
            }
          } catch (error) { /* 语言读取失败沿用默认 */ }
        };
        readLang();
        ctx.effect(function () {
          var dispose = locale.subscribe(function () { readLang(); emit(); });
          return function () { if (typeof dispose === "function") dispose(); };
        }, "note-tabs: locale");
      }

      ctx.effect(installStyles, "note-tabs: styles");

      ctx.effect(function () {
        return function () {
          if (anchorTimer) { clearTimeout(anchorTimer); anchorTimer = 0; }
          if (cardTimer) { clearTimeout(cardTimer); cardTimer = 0; }
          for (var index = 0; index < state.toasts.length; index += 1) {
            if (state.toasts[index].timer) clearTimeout(state.toasts[index].timer);
          }
          state.hover = HOVER_CLOSED;
          listeners.length = 0;
        };
      }, "note-tabs: client state");

      slots.inject("conversation.chat.assistant-actions", function () {
        return slots.register(
          { name: "conversation.chat.assistant-actions", id: "note-tabs-bookmark", order: 20, label: function () { return t("title"); } },
          function (props) { return h(BookmarkAction, props); },
        );
      });

      slots.inject("sidebar.panellist", function () {
        return slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 45, label: function () { return t("title"); } },
          function (props) { return h(SidebarEntry, props); },
        );
      });

      slots.inject("main", function () {
        return slots.register(
          { name: "main", key: PANEL_ID },
          function (props) { return h(NotesPanel, props); },
        );
      });

      slots.inject("shell.overlay", function () {
        var disposeCard = slots.register(
          { name: "shell.overlay", id: "note-tabs.hover", order: 86, label: function () { return t("hoverTitle"); } },
          function () { return h(HoverCardLayer, null); },
        );
        var disposeToasts = slots.register(
          { name: "shell.overlay", id: "note-tabs.toasts", order: 88, label: function () { return t("title"); } },
          function () { return h(ToastLayer, null); },
        );
        var disposeModal = slots.register(
          { name: "shell.overlay", id: "note-tabs.modal", order: 84, label: function () { return t("previewTitle"); } },
          function () { return h(NoteModal, null); },
        );
        return [disposeCard, disposeModal, disposeToasts];
      });

      load();
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    // 离线渲染测试的接缝：不挂到 window，只经模块导出，运行时无副作用。
    exports.__state = state;
    exports.__emit = emit;
    return module.exports;
  },
});
