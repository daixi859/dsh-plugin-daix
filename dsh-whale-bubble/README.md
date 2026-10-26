# dsh-whale-bubble 🐳

右下角悬浮鲸鱼小气泡插件：hover 显示当前工作区、Z.ai（智谱 GLM Coding Plan）5h 配额窗口、DeepSeek 余额与 OpenDesign 钱包 + 套餐窗口。数据面从 [dsh-fee-panel](../dsh-fee-panel/) 复制裁剪，独立路由与存储，与 fee-panel 互不依赖。

## 交互

| 操作 | 行为 |
| --- | --- |
| 收起态 | 38px 圆形半透明鲸鱼图标（55% 透明度，hover 实体化） |
| 鼠标移入 | 悬浮卡片：工作区名/目录、Z.ai 5h 窗口（百分比 + 重置时间）、DeepSeek 余额、OpenDesign（钱包 + 5h 窗口） |
| 点击图标 | 强制刷新全部数据（图标外圈转圈动画） |
| 卡片右上 ⚙ | 打开内联配置弹层（双 Key 输入 + 显示开关，✕ 关闭） |
| 刷新失败 | 图标右下红点角标，卡片底部错误行 |
| 未配置 Key | 图标降饱和（灰度） |

数据每 5 分钟自动刷新（固定，不做配置）；前端另以 15s 轮询同步状态。

## 配置

- Z.ai Key：优先 `WHALE_ZAI_API_KEY`，回落 `ZAI_API_KEY` / `BIGMODEL_API_KEY`（仅取 5h 窗口）
- DeepSeek Key：优先 `WHALE_DEEPSEEK_API_KEY`，回落 `DEEPSEEK_API_KEY`
- OpenDesign：优先 `WHALE_OPENDESIGN_API_KEY`，回落 `OPENDESIGN_KEY`（默认）/ `OPENDESIGN_CONTROL_KEY` / `VELA_CONTROL_KEY`
  - 必须是 **Control Key**（`vela_*`，来自 OpenDesign Cloud 或本机 `vela login` → `~/.amr/config.json` 的 `profiles.prod.controlKey`）。`sk-amr-*` 推理 Key 是另一个凭据，读账单会 401。
  - 工作区 id 不配置：首次查询经 `GET /api/v1/workspaces` 自动取 `items[0].workspaceId`，失败时清缓存重解析。
  - 查询端点：`GET amr-api.open-design.ai/api/v1/workspaces/{id}/billing/preflight`（`balanceUsd` + `codingPlan.windows[]`，18000s=5h / 604800s=7d）。
- 可在 ⚙ 弹层内直接保存 Key（写入本机凭据库，持久化于 `~/.dsh/storages/whale-bubble/config.json` 的只有显示开关）

## 安装

```bash
dsh plugin --profile <name> add dsh-whale-bubble
```

## 设计稿

[design/whale-bubble-mockup.html](design/whale-bubble-mockup.html) — 含收起/hover 卡片/配置弹层/刷新中/错误五态与明暗双主题（颜色全部走 `--dsw-alias-*` token）。

## 扩展

数据面 `snapshot()` 已预留 `extraRows` 通道（providers 数组可直接加条目，卡片按 quota/balance 通用渲染），后续功能优先以新 provider 或新行的形式接入。
