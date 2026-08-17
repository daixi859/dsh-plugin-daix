# dsh-usage-suite

dsh Web 界面的三服务商模型用量插件:输入框上方 dock 里显示**当前会话正在使用的
provider** 的用量,切模型即切 chip,其他两个 provider 不取数。

| 会话 provider | chip | 数据来源 |
|---|---|---|
| `opencode-go` | `OpenCode Go: 5h 0% (28m) · wk 22% (15h 40m) · mo 11% (27d 17h)` | `https://opencode.ai/workspace/<id>/go` SSR(cookie,兼容中英文标签) |
| `deepseek` | `DeepSeek: ¥110.52` | `https://api.deepseek.com/user/balance`(API key) |
| `zai-coding-cn` | `GLM Plan: 5h 63% (1h 12m)` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit`(API key,Authorization 传裸 key) |

其他 provider(如 `zhipu` 按量付费)不显示 chip。

## 设计要点

- **按需加载**:浏览器端只请求当前 provider 的数据;host 端从不在后台主动抓取。
- **不轮询**:没有任何定时器。取数时机 = 组件挂载(读 host 缓存)、`turn/start`
  (仅重新识别 provider,让切模型后 chip 立即切换)、`turn/end`(一轮结束后拉一次)、
  手动刷新按钮(强制)。host 端每个 provider 60s 缓存 + 60s 失败冷却,连续快速对话
  时上游最多每分钟一次。
- **凭据不进浏览器**:`/api/model-usage/config` 只返回 `••••`+末 4 位掩码;错误信息
  自动 redact 密钥;cookie 只在 host 侧使用。

## 凭据解析(优先级从高到低)

1. `~/.dsh/usage-suite.json`:
   ```json
   {
     "ocgo": { "workspaceID": "wrk_…", "cookie": "auth=Fe26.2…; oc_locale=en" },
     "deepseek": { "apiKey": "sk-…" },
     "zhipu": { "apiKey": "…" }
   }
   ```
2. 环境变量:`OPENCODE_GO_WORKSPACE_ID` / `OPENCODE_GO_COOKIE`、`DEEPSEEK_API_KEY`、
   `ZAI_CODING_CN_API_KEY`(在 `dsh web` 的启动环境里)
3. `~/.dsh/.credentials.yaml` 中的同名条目
4. ocgo 回退:已有的 `~/.dsh/ocgo-usage.json`(dsh-ocgo-usage 的配置,cookie 直接复用)

也可以在 GUI 里点 chip → Set 直接编辑当前 provider 的凭据(写入 usage-suite.json)。

> cookie 粘贴裸值 `Fe26.2…` 即可,自动补 `auth=` 前缀;`oc_locale` 强制为 `en`
> (重置时间的英文短语解析更稳,中文标签也已兼容)。

## 安装 / 卸载（官方 profile-bundle 机制）

本包声明了 `dsh.bundle.patch`（→ `cordis.patch.yml`），用 dsh 自带的插件命令管理：

```bash
# 安装（把 <path> 换成本目录绝对路径；依赖 + bundle 层一次到位）
dsh plugin --profile web add <path>
# 重启 dsh web 并刷新页面

# 卸载
dsh plugin --profile web remove dsh-usage-suite
# 重启 dsh web
```

无需手工编辑 profile 的 `package.json` / `cordis.patch.yml`——`add` 完成后
reconcile 自动把 `dsh-usage-suite` 收进 `dsh.profile.bundles` 层列表（判断依据
就是 `dsh.bundle` 声明），`remove` 自动移除。

## Host API(同源 JSON)

- `GET /api/model-usage?provider=ocgo|deepseek|zhipu` — 单 provider(缓存感知)
- `GET /api/model-usage` — 三者聚合(调试用)
- `GET /api/model-usage/refresh?provider=x` — 强制刷新
- `GET|POST /api/model-usage/config` — 掩码视图 / 部分写入

## 已知限制

- DeepSeek 官方只有余额 API,没有用量百分比;余额 < ¥10 时 chip 变黄。
- OpenCode Go 页面若改版,SSR 解析可能失效(显示 `<err:http302>` 类错误);更稳的
  官方配额 API(`GET https://opencode.ai/zen/go/v1/usage`,Bearer API key)可作为
  日后的替代路径。
- GLM Coding Plan 只显示 `TOKENS_LIMIT`(5 小时 token 窗口);其他 limits 类型忽略。
