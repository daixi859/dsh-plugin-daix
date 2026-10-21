# dsh-mcp-gate · 添加 MCP 服务器功能方案

用户已确认（grill-me 拷问结论）：写入走 configEditor 优先、保存时提示重启、env 支持 `${ENV}` 引用语法、内置 3-5 个常用模板。

## 零、能力边界（configEditor 源码核实，.tmp-asar/dsh-config-editor/lib/index.js）

| 操作 | 路径 | 生效 |
|---|---|---|
| **编辑现有服务器**（command/url/env/headers/exposure 初值） | `configEditor.edit(entry, change)`：写 profile patch 的 `config` 块，文件锁+原子写+失败回滚，自动走 Loader reconciliation | **热生效，无需重启** |
| **新增服务器**（新 insert 行） | configEditor 只能改已存在 entry 的 config（`entries()` 仅返回已加载行，编辑逻辑排除 `insert` 行）→ 回退直接写 profile patch 文件 append insert 行 | 需重启 profile（Loader 对 patch 文件是否有 watcher 待实现时验证，有则自动生效） |
| **删除服务器** | 同新增：从 patch 文件移除该行 | 需重启 |

`edit` 的 `change(current, inherited)` 返回新 config；写入前有 waterfall(`internal/config`) + resolveConfig 校验，非法配置会在落盘前报错——安全网是现成的。

## 一、数据流

```
UI 表单
  → POST /plugins/mcp-gate/add      {mode:"insert", name, transport, command?, args?, env?, cwd?, url?, headers?}
  → POST /plugins/mcp-gate/update   {id, config 同上}        ← configEditor.edit 热生效
  → POST /plugins/mcp-gate/remove   {id}
Host 侧：
  update：entries().find(id) → edit(entry, () => next) → 成功返回 {ok, applied:"hot"}
  add/remove：定位 profile patchPath（configEditor.documentPath 即 profileContext.patchPath）
              → YAML sequence append/remove {id:"mcp-<name>", name:"@deepseek-ai/dsh-mcp-client", insert:"...", config:{...}}
              → 返回 {ok, applied:"restart-required"}（若探测到热重载则 {applied:"hot"}）
```

- 服务器的 Cordis 行形状以 `D:\pi\mcp-servers-bundle\cordis.patch.yml`（playwright stdio + github http 两个实例）为参考模板。
- serverName 校验 `[A-Za-z0-9_-]{1,32}` 全局唯一（dsh-mcp-client 契约）；patch 行 id 建议 `mcp-<serverName>`。

## 二、${ENV} 引用语法

- env 值 / header 值支持 `${VAR}`：**落盘只存引用字符串**，运行时由服务器进程环境解析（stdio 子进程继承环境；http headers 由 mcp-client 组装时解析——若 mcp-client 不解析 header 引用则 v1 仅 stdio env 支持，headers 明文，文档标注）。
- UI：输入 `${` 开头的值显示「env 引用」badge，避免误以为是明文 key；保存前检测纯高熵明文值给一次性提醒（启发式：长度≥24 且无空格且混大小写数字）。
- 模板里的 GitHub Token 等一律写 `${GITHUB_TOKEN}` 形态。

## 三、UI（草图见 mcp-add-server-mockup.html）

- 服务器列表头部新增「+ 添加服务器」按钮 → 模态面板：
  - 模板 chips：空白 / Filesystem / Fetch / Memory / Playwright / GitHub(HTTP)
  - 名称（实时校验 `[A-Za-z0-9_-]{1,32}` + 重名检测）
  - transport 分段（stdio / HTTP）切换表单区
  - stdio：command、args（每行一个）、env 键值行（+ 添加变量）；HTTP：url、headers 键值行
  - 保存按钮 + 语境化提示：新增→「保存后重启 DSH 生效」；编辑→「保存后立即生效」
- 行卡片新增「编辑」入口（同面板预填）与「删除」（确认后移除，提示重启）。
- 新增未重启的行显示「待重启」badge；重启后由 live schemas 并集自然纳管（默认 deferred 折叠，进 mcp_search 索引）。

## 四、风险与待验证

1. Loader 对 profile patch 文件的 watcher：新增行后不重启是否自动 reconcile——实现时先实验，行为决定 badge 文案。
2. mcp-client 是否解析 headers 里的 `${VAR}`——不支持则 HTTP 服务器的 header 凭据 v1 明文（文档标注）。
3. 直接写 patch 文件与用户手改并发：复用 configEditor 同款 `withFileLock(package.json)` 语义不可得（它是内部 API），mcp-gate 侧用读-改-写 + 失败重读重试，写入前保留 `.bak`。
4. desktop GUI 进程长驻：profile patch 被外部修改后 GUI 的 Loader 是否热重载——同风险 1。
