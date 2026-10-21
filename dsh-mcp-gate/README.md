# dsh-mcp-gate

MCP 渐进式披露 + 三层开关管理的 DSH 插件。MCP 工具默认折叠出模型上下文，模型按需通过 `mcp_search`（BM25）检索解锁；系统提示内置 server 目录（一行描述/服务器）帮模型精准检索；总开关、服务器级开关、项目级覆盖三层控制，配置页挂在 Web GUI 设置区。

## 原理

渐进披露三层（对应 MCP 官方 client 最佳实践的 Catalog → Inspect → Execute）：

1. **目录层**：`systemPrompt.section("mcp-gate:servers", order 900)` 每服务器一行 `- name (N tools): summary`；summary 优先取配置的 `description`（add/update 表单可填，≤250 字），其次服务器 `initialize.instructions` 首行，兜底工具名聚合。文本变化才重注册（幂等短路）。
2. **检索层**：`mcp_search`（BM25 k1=1.2 b=0.75 索引：工具名+拆名+描述+参数 schema 文本+`[server name: desc]` 语义增强；只拼描述文本、工具名聚合不进索引防 BM25 污染）。
3. **执行层**：命中的工具下轮起可调用（见下）。

- 每个 MCP 工具（`mcp__<server>__<tool>`）默认不出现在模型工具列表：插件对每个 agent 的 ctx 调 `tools.restrict({ deny })`。
- 模型 search 命中 → 名字进 unlocked → restrict 名单收缩 → 下轮 schema 出现该工具。
- `tools/change` 驱动重算；deny 名单幂等短路（排序比较相同则不动）防自激循环。

## 内置连接器（推荐接入方式）

`lib/connector.js` 内置 stdio / streamable-http 双传输 MCP 客户端：插件自身连接服务器、注册远程工具（`makeRemoteTool`），**不依赖官方 mcp-client patch 行、无需重启**。

- 连接池：`pool: Map<name, {conn, cfgKey}>`，`cfgKey = JSON.stringify(connector)`；`syncConnections()` 串行化对账（断开多余/重建变化/新建缺失），任何配置落盘后调用。
- **连接器工具注册到全局 ctx**（`syncGlobalTools`，`globalTools` 簿记）：agent scope 注册的工具不进 `schemas()` 快照、restrict 也折叠不了（restrict 只作用于继承面）——注册到 agent scope 的版本症状是"模型能直接调用但搜索找不到、也无法折叠"。
- 连接条件：master 开 && 全局 enabled（项目覆盖只影响工具可见性，不影响连接）。
- 远程工具注册按 agent 同步（`syncMcpTools`，幂等对齐 want 集，同名撞车标记 mcpRegistered 防刷）；`${VAR}` 引用在进程环境取值注入（密钥不明文落盘）。
- 遗留 patch 接入（profile patch 里的 `mcp-<name>` insert 块）继续只读兼容，UI 标"遗留"徽章并一键 `POST /migrate` 迁移（删 patch 块 + 写 config.json connector + 即时连接）。

## 三层配置

生效规则：`enabled_eff = mcpEnabled && (project.enabled ?? global.enabled ?? true)`

1. **总开关** `~/.dsh/plugins/mcp-gate/config.json` 的 `"mcpEnabled"`（false 时全部 MCP 折叠且 mcp_search 提示已禁用）。
2. **全局服务器级** 同文件 `"servers": { "<name>": { "enabled": bool, "description": "一句话描述（目录段+检索增强）", "exposure": "direct|deferred|hidden", "toolExposure": { "<raw>": "direct|hidden" } } }`。`direct` 不折叠；`deferred` 折叠但可检索（默认）；`hidden` 折叠且不可检索。
3. **项目级覆盖** `<工作区>/.dsh/mcp-gate.json` 的 `"servers": { "<name>": { "enabled": true|false } }`，只写覆盖项。

配置页：Web GUI → 设置 → MCP 网关（settings.section slot）。行卡片支持全局开关直切、三态组（继承/项目开/项目关）、per-tool exposure 循环切换。

## HTTP 接口（webServer，/plugins/mcp-gate/*）

- `GET /state?cwd=<工作区>`：master + 每服务器视图（live 工具 ∪ 全局配置 ∪ 项目覆盖 ∪ patch 接入声明，含 effective 状态与 per-tool 明细；`connector` 字段为编辑面板预填视图，`editable` 标记可编辑）。
- `POST /master` `{enabled}`；`POST /global` `{server, enabled?, exposure?, tool?, toolExposure?}`（`tool` 路径 null 删覆盖）；`POST /project` `{cwd, server, enabled: true|false|null}`。均落盘后全 agent 重算。
- `POST /add` `{name, description?, transport, command?, args?, env?, cwd?, url?, headers?}`：写入 config.json `servers[name].connector`（description 一并存档）并即时连接，返回 `applied: "live", status, tools`；重名（live ∪ 全局 ∪ patch）拒绝。
- `POST /update` `{name, description?, ...同上}`：替换 connector 与 description（enabled/exposure/toolExposure 保留）→ cfgKey 变化自动断开重连（`applied: "live"`）；对遗留 patch 服务器编辑即自动迁移（删 patch 块）。transport 切换时清理反侧字段。
- `POST /remove` `{server}`：连接器托管 → 断开 + 删配置（`applied: "live"`）；仅存于 patch → 删 insert 块（`applied: "restart-required"`）。
- `POST /migrate` `{server?}`：patch 声明的服务器迁到内置连接器并即时连接，缺省迁移全部；返回 `{migrated: [...]}`。

### 接入管理与 ${ENV} 引用

- add/update 的 `env`/`headers` 值支持 `${VAR}` 引用：连接时从进程环境取值注入，**密钥不明文落盘**；UI 对疑似密钥（token/key/secret/password/authorization）明文值黄条警示。
- 编辑面板回显遗留 patch 的 `!!js` 值时反解回 `${VAR}` 形态。
- 内置模板：GitHub (HTTP)、Playwright (stdio)、Fetch (stdio)。


## agent 侧时序要点（踩坑记录）

- `agent/created` 串行监听内**同步先** `register(mcp_search)`，再做任何 await——否则首个 prompt 组装看不到搜索工具。
- `ToolDefinition` 必须带 `output: { schema, render }`（否则注册被拒）；`output.schema` 的 properties 内层不允许 `required`。
- 直接 `register` 裸对象时 `parameters` 不会被编译：必须写 object-rooted JSON Schema（`{type:"object", properties, required}`），不能用 defineTool 的 per-key 简写。
- 工作目录：`workingDirectory.get(agent)` 会抛异常（要 Session 对象）；用 `await wd.ensure(agent)`。
- `restrict` 的 deny 名单只能含当前已注册的工具名（unknown names fail）；tools/change 由 restrict 自身触发，重算必须幂等。
- `agent.ctx.tools.schemas()` **不含 agent scope 自注册的工具**（restrict 也管不到它们）——需要被折叠/检索的工具必须注册到全局 ctx；per-agent 注册只适合每 agent 独立的工具（如 mcp_search）。
- 工具 `execute` 返回值会被框架做 lossless JSON 校验：带 `undefined` 字段（如 `structuredContent: undefined`）会被拒（症状 `tool "X" returned invalid output: value is not lossless JSON`），只回已定义字段。
- **config.json 里的 `!!js` 表达式要插件自己求值**：Loader 只求值 patch 文件里的 `!!js`；config.json 是纯 `JSON.parse`，`!!js '`Bearer ${process.env.GITHUB_TOKEN}`'` 会原样进 HTTP 头（症状 GitHub `Authorization header is badly formatted`）。connector.js 的 `connectServer` 入口经 `evalServerCfg`/`evalJsValue` 求值（headers/env/command/cwd/url/args）。
- **Windows spawn npx/uvx 必须 `shell: true`**（它们是 .cmd 批处理，不带 shell 直接 ENOENT），且 `child.on("error")` 必须监听——否则 spawn 失败成为未捕获异常打崩宿主进程。stdio 传输经 `transport.onFail` 把 spawn 错误快速失败传导给 initialize。
- `setx` 设置的环境变量对**已运行的进程不可见**（包括从旧 Explorer 启动的 GUI）；改完后要重启 GUI 进程（必要时注销重登）。UI 连接错误显示服务器返回的真实错误文本，先看错误再排查。

### patch 管理（编辑弹窗）踩坑

- **绝不用 `configEditor.edit` 改 insert 块服务器**：它在 patch 文档里找不到非-insert 的同 id 行时，会 append 一个顶层 config 行（dsh-config-editor `findLastIndex` 失败即 `document.add`），与 insert 块构成 duplicate id，且 config 是 loader 内存态转写（会把弹窗里已改掉的旧 headers 键名带回来复活）。handleUpdate 一律走 `updateServerInPatch`（文本级删块重建）。
- `stripStrayServerRows`：add/update/remove 写盘前自动清除 `mcp-<name>` 的顶层遗留直接 entry（configEditor append 遗留、用户手贴的 2 空格块），isClient 校验保证不误删非 mcp-client 的同 id 行。
- **删块必须循环吞块头**：块结构是 `# mcp-gate: 注释` ← `- insert:` ← id 行。removeBlockFromText 早期版本从 id 行开删、不吞块头，留下 `- insert:` 空壳项（Loader 视作 insert: null）；后来只吞一行又漏掉注释。现为循环吞到不动为止 + `cleanEmptyInsertShells` 在所有写盘前兜底清理空壳。
- 所有 patch 写入经 `writePatchChecked`：`.mcp-gate.bak` 备份 + debugLog 打点（写前/写后字节数），出现"改了又被改回"先对比 bak 与 debug.log。

## 调试

环境变量 `MCP_GATE_DEBUG=1` → 日志写 `~/.dsh/plugins/mcp-gate/debug.log`（apply / agent/created / register / recompute / restrict deny 名单 / cwd 解析重试）。

## 测试

- `node test/connector-unit.mjs`：内置连接器单测（17 项）——RPC 纯函数（ndjson/SSE/错误提取）、stdio 真连 mini-mcp-server、node:http 假 streamable-http 服务器（SSE+session 头）、死端口与超时路径。
- `node test/patch-unit.mjs`：patch 管理逻辑单测（43 项）。从 `lib/index.js` 大括号配对提取纯函数，覆盖 buildInsertBlock→readPatchServers 往返（stdio+env / http+!!js）、追加、删除、就地更新、`.bak`、desktop 真实 patch 只读解析、normalizeServerInput 校验、connectorView/jsToEnvRef 显示转换、stripStrayServerRows 遗留行清理、cleanEmptyInsertShells 空壳清理。
- E2E 见下节；`test/mini-mcp-server.js`（echo/time_now/add 三工具）为验证 fixture。

## E2E 复跑（headless）

```powershell
# test/e2e-live.ps1：备份 config.json → 写入 demo 内置连接器配置 → dsh headless 全链路 → 恢复
pwsh -NoProfile -ExecutionPolicy Bypass -File <abs>/test/e2e-live.ps1
# 断言：final 含 echo: hello-connector（mcp_search 解锁 → mcp__demo__echo 调用成功）
# 注意：必须用 pwsh 7 执行（Windows PowerShell 5.1 按 ANSI 读 UTF-8 脚本会解析错乱）
# 旧版场景（patch 接入）fixture：test/e2e-patch.yml 只含 zai 模型行；proj-disabled / proj-enabled 项目覆盖目录
```
