# dsh-note-tabs

把每轮回答收藏成 Markdown 便签的 DSH 插件。

| 面 | 插槽 |
|---|---|
| 收藏按钮 | `conversation.chat.assistant-actions` |
| 左栏图标 | `sidebar.panellist` |
| 悬浮窗 | `shell.overlay` |
| 详情页 + 设置 tab | `main`（key = `note-tabs`） |
| 撤销 Toast | `shell.overlay` |

## 安装

在仓库根执行（本机 DSH 为桌面版、无 `dsh` CLI 时，用 **插件 → 添加插件 → 本地目录** 指向本目录）：

```bash
dsh plugin --profile desktop add ./dsh-note-tabs
```

安装后重启 DSH 并刷新页面。本机没有 `dsh` CLI 时，用 GUI 的插件管理：**插件 → 添加插件 → 本地目录**，指向 `dsh-note-tabs`。

## 验证状态

- `node --test` 61 项：存储纯逻辑 19 项、host 路由集成 9 项（含原子写、坏文件回退、错误码）、client 工厂冒烟 4 项、文案表一致性 3 项、组件渲染冒烟 6 项（含「展开态真走 MarkdownText」「浮层就地新建」）、静态守卫 7 项（禁裸 `close()`、禁自写 Markdown 解析器、`memo` 对象判定、发送语义、禁写死字体栈、新建便签链路、JSX 类名与样式完整性 + 浮层可见性开关）。
- 全部 lib 文件 `node --check` 通过；样式只用 `--dsw-alias-*` 主题 token 与 DSH 的字体/字号 token。
- Markdown 渲染直接复用基线段模块 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（属 `PLATFORM_MODULES`，因此**不**写进 `dsh.client.external`）。注意它是 `React.memo` 的产物：判定可用性时必须接受 `object`，只看 `typeof === "function"` 会静默降级成纯文本。
- **未在浏览器里实测**：本机无 `dsh` CLI、插件管理工具不下发到本会话，需用户在 GUI 里安装后确认五个面与深色模式。

## 开发

```bash
node --test "dsh-note-tabs/test/*.test.mjs"
```

- `lib/notes.js` 纯逻辑（存储形状、去重键、增删改），无副作用，测试覆盖。
- `lib/index.js` host 面：`POST /plugins/note-tabs/rpc` 读写 `notes.json`。
- `lib/client.js` client 面：`window.__ModuleLoader__` 工厂，注册四个插槽。

设计稿在 `design/`（`mock.html` 可直接打开交互）。
