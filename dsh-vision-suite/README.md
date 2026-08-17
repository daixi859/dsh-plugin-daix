# dsh-vision-suite

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 图像识别套件——两个协同能力，一条链路：

| 能力 | 说明 |
|---|---|
| **粘贴/拖入转路径** | 在 Web 输入框 `Ctrl+V` 粘贴图片、或把文件（任意类型）拖进输入框时，自动保存到临时目录并在光标处插入**文件路径**，而不是走附件通道——彻底绕开「当前模型不支持图片」的模态门槛（拖入的文件路径也可直接给 `read` 等工具读）。右下角有「图片→路径 / 图片→附件」开关（记忆在浏览器）。 |
| **`recognize_image` 工具** | 模型可直接调用的识图工具：本地路径 / http(s) URL / base64 data URI 输入 + 可选指令，走 OpenAI 兼容视觉 API（默认小米 MiMo `mimo-v2.5`），返回识别文本。 |

两者组合的典型用法：截图 → `Ctrl+V` 或直接拖入（自动变路径）→「识别这张图」。

## 实现要点

- **深度思考默认关闭**（`thinking: disabled`）：实测识图转录任务开/关思考质量一致，但 token 消耗约 4 倍差距；且 MiMo 的思考 token 计入 `max_tokens`，长思考链会挤占正文预算（曾导致空返回/截断）。需要时可在配置中打开。
- **`finish_reason` 显式防护**：预算耗尽零正文时抛出明确错误；正文被截断时在尾部追加截断标记——不再无声失败。
- **凭据走 DSH 凭据库**：`~/.dsh/.credentials.yaml` → 环境变量 → 行配置字面 key，按调用解析，不落盘到代码。
- **保存路由有安全边界**：仅 POST + JSON、同源 Origin 校验、大小上限；v1.1.0 起接受任意文件类型，但落盘文件名完全由服务端生成，客户端文件名只贡献一个白名单化的扩展名（拒绝路径分隔符/控制字符）。
- **TUI 兼容**：`webServer` 为可选获取——纯终端组成下没有 Web 路由，`recognize_image` 工具照常可用。

## 环境要求

- 已安装 DeepSeek Harness（`dsh`）并至少运行过一次 `dsh web`（生成 profile）
- Node.js >= 18（dsh 自带要求）
- pnpm（`npm i -g pnpm`）
- 一个 OpenAI 兼容视觉 API 的 Key（默认端点为小米 MiMo）

## 快速安装（官方 profile-bundle 机制）

本包声明了 `dsh.bundle.patch`（→ `cordis.patch.yml`），用 dsh 自带的插件命令管理：

```bash
cd ..                      # 不要在本目录内执行，用绝对路径引用
dsh plugin --profile web add /绝对路径/dsh-vision-suite
```

`add` = 在 profile 目录跑 pnpm + reconcile：依赖装好后，凡声明 `dsh.bundle` 的包
自动进入 `dsh.profile.bundles` 层列表，loader 读取包内 `cordis.patch.yml` 组合挂载。
不再需要任何手工编辑或安装脚本。

> 首次在本目录执行过 `pnpm install`（宿主侧依赖 `@deepseek-ai/dsh-tools`、
> `@deepseek-ai/schemastery` 装在本目录 `node_modules`，`link:` 挂载从真实路径解析）。

> 使用 `$DSH_HOME` 自定义主目录时，profile 位于 `$DSH_HOME/profiles/web`，命令自动识别。

### 配置 API Key

在 `~/.dsh/.credentials.yaml` 中加入一行（推荐，DSH 凭据库托管）：

```yaml
VISION_API_KEY: sk-xxxxxxxx
```

或在启动 `dsh web` 的环境里 `export VISION_API_KEY=sk-xxxxxxxx`。

### 生效

重启 `dsh web` 并刷新浏览器。验证：

- 右下角出现「图片→路径」开关胶囊；
- 截图后 `Ctrl+V`，输入框出现 `C:\Users\...\AppData\Local\Temp\dsh-paste\img-....png` 样式的路径；
- 把任意文件（图片、PDF、txt 等）拖进输入框，输入框出现对应的临时文件路径；
- 对模型说「识别 <路径>」，会看到 `recognize_image` 工具调用。

## 配置参考

默认值开箱即用。需要调整时，在 **profile** 的 `~/.dsh/profiles/web/cordis.patch.yml`
里按 id 覆盖（不要改包内的 patch 文件，那是随包分发的层）：

```yaml
- id: vision-suite
  config:
    # ── 识图 ──
    baseURL: https://api.xiaomimimo.com/v1   # 任意 OpenAI 兼容视觉端点
    model: mimo-v2.5
    apiKeyEnv: VISION_API_KEY                 # 凭据引用名
    maxTokens: 8192                           # 生成预算（推理 token 计入）
    thinking: disabled                        # enabled | disabled
    timeoutMs: 120000
    maxImageBytes: 12582912                   # 本地图片 12MB 上限
    # ── 保存（粘贴/拖入共用）──
    directory: ""                             # 默认 $TMPDIR/dsh-paste
    maxPasteBytes: 12582912                   # 单文件 12MB 上限
```

换视觉供应商通常只需改 `baseURL` + `model` + key。

## 卸载

```bash
dsh plugin --profile web remove dsh-vision-suite   # 之后重启 dsh web
```

## 故障排查

| 症状 | 处置 |
|---|---|
| 工具返回空文本 / 被截断 | 旧版本症状；确认本套件版本 >= 1.0.0（含 `maxTokens: 8192` + `thinking: disabled` + 截断防护），并已重启 `dsh web` |
| 修改源码后不生效 | `link:` 挂载是实链接、改动即时可见，但 bundle/client 元数据有进程内缓存——重启 `dsh web` 并强刷浏览器即可 |
| 右下角没有开关胶囊 | `dsh web --dump-config` 里确认 `# == dsh-vision-suite` 层与 `- id: vision-suite` 行存在、浏览器是否强刷 |
| `no API key` 错误 | 按「配置 API Key」一节存放 `VISION_API_KEY` |
| 关键数字识别错 | 优先提供高分辨率原图（低分辨率截图小字必然漂移）；窄 prompt「逐字抄写」比「完整描述」更可靠 |
| 粘贴/拖入报「文件保存失败：HTTP 405」 | 宿主路由未注册（请求落到 SPA 静态服务，POST 被拒为 405）。v1.0.1 起改用 `ctx.inject` 声明式等待 webServer 上线，已修复；重启 `dsh web` 即可 |
