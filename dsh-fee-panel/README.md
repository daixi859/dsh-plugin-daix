# dsh-fee-panel

侧边栏底部紧凑费用面板（Dynamic plugin `feebar-1` 的项目固定版，样式/行为 = pkg-5）。

- **位置**：左侧边栏底部（`sidebar.footer.action`），单行磁贴（最多 4 个/行，空间不足自动收窄并隐藏百分比），无标题行，**点击磁贴 = 刷新该供应商**
- **供应商**：Z.ai（5h/周配额）、Kimi（订阅周窗/5h 或 PAYG 余额）、DeepSeek（余额）、MiMo（余额，套餐% 在 Tooltip）；余额类供应商金额显示在磁贴下排，Tooltip 仅保留窗口明细/重置时间/错误/更新时间
- **配置**：设置 → 费用展示 —— 顶部勾选控制侧栏显示哪些（持久化），下方配置各家的 Key / MiMo Cookie
- **凭据**：自定义 Key 写本机凭据库（`FEEPANEL_*` 引用，持久）；未设置时自动回落环境变量：
  `ZAI_API_KEY`/`BIGMODEL_API_KEY`、`KIMI_CODING_API_KEY`/`MOONSHOT_API_KEY`/`KIMI_API_KEY`、
  `DEEPSEEK_API_KEY`、`MIMO_COOKIE`
- **网络**：host 经 `subprocess` 直接 spawn `curl.exe`，凭据只走 stdin（`curl -H '@-'`），不进命令行/环境变量
- **刷新**：启动首轮 + 每 5 分钟自动；勾选关闭的供应商不发请求

## 数据通道（webServer 路由）

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/plugins/fee-panel/state` | — | `{ ok, providers: [...] }` |
| POST | `/plugins/fee-panel/refresh` | `{ id? }` | `{ ok, providers }` |
| POST | `/plugins/fee-panel/set-key` | `{ id, value }`（空串=清除） | `{ ok, providers }` |
| POST | `/plugins/fee-panel/set-enabled` | `{ id, enabled }` | `{ ok, providers }` |

## 显示勾选持久化

`~/.dsh/storages/fee-panel/config.json` → `{ "enabled": { "zai": true, ... } }`

## 安装（web profile）

```powershell
dsh plugin --profile web add dsh-fee-panel
# 或本地路径：
dsh plugin --profile web add D:\wsl\dsh-plugin-daix\dsh-fee-panel
```

`cordis.patch.yml` 会把 `id: fee-panel` 行插入 host 组合（由 package.json 的 `dsh.bundle` 声明识别）。

> 注意：与动态插件 `feebar-1` 同时启用会重复渲染侧栏磁贴——二选一，启用本项目版前先停用动态版。
