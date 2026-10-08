# dsh-web-fetch-http-open

`web_fetch` 的无 IP 校验替代 provider。

## 原理

`web_fetch` 工具（`@deepseek-ai/dsh-tool-web`）本身不联网，取数走 `ctx.web.fetch()`，
由注册在 `ctx.web` 上的 fetch provider 执行。内置 provider
`@deepseek-ai/dsh-web-fetch-http`（id=`http`）在 DNS 解析后强制要求答案集全部是公网
单播地址（`resolvePublicAddresses`），解析到 127.0.0.1 / 10.x / 192.168.x 等地址一律抛
`WEB_BLOCKED_URL` —— 这就是访问本机服务被拦的原因。

本插件注册一个 id=`http-open` 的新 provider，并把 `web` 服务的
`fetchProvider` 配置从 `http` 覆盖为 `http-open`：

- **首选路径**：从宿主运行时 import 官方 `@deepseek-ai/dsh-web-fetch-http`，用
  `new HttpFetchProvider(limits, resolver)` 直接实例化官方类（构造器第二参数就是官方
  预留的 resolver 注入点），仅把"公网校验"这一步换成不过滤的解析器。重定向、
  字节/字符上限、charset 解码、超时、undici 地址固定等全部是官方原码。
- **兜底路径**：宿主模块定位失败时，使用内置的行为等价实现（同样的 URL 校验、
  同源重定向、上限与错误码；无地址固定、无代理策略）。
- `WebError` 优先复用宿主 `@deepseek-ai/dsh-web` 的同一个类，错误码照常结构化。

## 安装（desktop profile）

desktop profile 由 Electron 应用独占管理，`dsh plugin --profile` CLI 会拒绝，用 GUI 的
插件管理或本会话的 plugin_manager 工具安装：

```text
plugin_manager install_bundle  target: link:D:/wsl/dsh-plugin-daix/dsh-web-fetch-http-open
```

等价的手动落盘结果（plugin_manager 已代为完成，列此备查）：

1. `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加
   `"dsh-web-fetch-http-open": "link:D:/wsl/dsh-plugin-daix/dsh-web-fetch-http-open"`，
   `dsh.profile.bundles` 末尾加 `"dsh-web-fetch-http-open"`；
2. 在 profile 目录 `pnpm install`；
3. 重启 DSH（或由插件管理热重载 profile）。


bundle patch（`cordis.patch.yml`）会：

1. `insert` 插件行 `web-fetch-http-open`；
2. 覆盖 `web` 行的 `config` 为 `{ searchProvider: deepseek-official, fetchProvider: http-open }`
   （patch 按 id 整键替换，因此 config 整块给出）。

停用/移除本 bundle 后两条 patch 一并消失，内置 `http` provider 自动恢复。

## 配置

无 schema；支持与官方一致的限额字段（可选）：`maxResponseBytes`（默认 5MB）、
`maxBodyChars`（默认 100k）、`timeoutMs`（默认 30s）、`maxRedirects`（默认 5）、
`userAgent`。

## 安全提示

公网 IP 校验是防 SSRF 的：模型选择的 URL 不应摸到本机/内网服务。启用本插件即表示
接受 `web_fetch` 可以访问 127.0.0.1、局域网等非公网地址。
