# 费用展示插件设计稿（fee-panel）

> 状态：设计稿 v1，未写代码。确认后再进入 `cordis_define` 实现阶段。

## 1. 目标与范围

- 在左侧边栏底部（`设置` 按钮上方，与现有 dsh-cost-meter 相同区域）展示 4 家供应商的费用/额度：
  **z.ai（智谱 GLM Coding Plan）、Kimi / Moonshot、DeepSeek、MiMo（小米）**。
- 比现有 dsh-cost-meter 底部区块**更紧凑**：整个区块目标高度 ≤ 110px（现状约 130px+），一行一个磁贴、2×2 网格排布。
- 配置只做一件事：**设置 Key**。不设置时自动回落到环境变量。
- 数据来源参考当前安装的 `dsh-cost-meter@1.7.31`（位于 `~/.dsh/profiles/web/node_modules/.pnpm/dsh-cost-meter@1.7.31/...`），只取其只读查询端点与凭据发现顺序，不依赖该插件运行。

## 2. 数据获取方案（逐家确认过）

| 供应商 | 类型 | 只读端点 | 凭据（配置页可覆盖） | 环境变量回落（优先级从高到低） | 展示内容 |
|---|---|---|---|---|---|
| z.ai | 订阅配额 | `GET https://api.z.ai/api/monitor/usage/quota/limit`，401 时换域 `https://open.bigmodel.cn/...`（两域 Key 不互通，逐域尝试） | Coding Plan 专属 Key | `ZAI_API_KEY` → `BIGMODEL_API_KEY` | 5h 窗口已用 %（+reset 时刻） |
| Kimi | 订阅配额 + 余额 | 订阅：`GET https://api.kimi.com/coding/v1/usages`（UA `KimiCLI/1.6`，仅 `sk-kimi-*` Key）；无订阅 Key 时降级余额：`GET https://api.moonshot.cn/v1/users/me/balance` | Kimi Code 订阅 Key 或开放平台 PAYG Key | `KIMI_CODING_API_KEY` → `MOONSHOT_API_KEY` → `KIMI_API_KEY` | 订阅：周窗/5h 已用 %；PAYG：余额 ¥ |
| DeepSeek | 余额 | `GET https://api.deepseek.com/user/balance`（Bearer；仅官方域名，非官方 baseURL 拒发，防 Key 泄漏） | 开放平台 Key | `DEEPSEEK_API_KEY` | 余额 ¥（total/granted/toppedUp） |
| MiMo | 余额 + Token Plan | `https://platform.xiaomimimo.com/api/v1` 下的 balance / token-plan 接口 | ⚠️ **无 API-Key 化端点**，需要控制台 Cookie（`api-platform_serviceToken` + `userId`） | 无官方 env 约定；约定 `MIMO_COOKIE`（整段 Cookie 头） | 余额 ¥ + Token Plan 剩余 |

关键差异提示：**MiMo 没有 API Key 查询端点**（与 cc-switch #2488、CodexBar 文档结论一致，只能走控制台 Cookie）。配置页对 MiMo 要的是「Cookie」而不是「Key」，这是四家唯一的特例。

安全约束（沿袭 cost-meter 的契约）：
- 所有请求只读 GET；**禁止**触碰任何补全/消费类端点（避免产生计费副作用）。
- Key 只发往各家官方域名；DeepSeek 强制 `api.deepseek.com`，z.ai 只允许 `api.z.ai` / `open.bigmodel.cn`。
- 超时 15s，瞬时网络错误自动重试一次；401/403 视为「凭据失效」软错误，不重试。
- 动态插件为进程级临时体：配置页设置的 Key **仅存内存**，进程重启后丢失并自动回落环境变量（环境变量是持久方案）。不落盘、不写 settings 存储。

## 3. 架构落点（Host + Client 双半）

- **Host**：四家 fetcher（纯函数解析器 + 固定请求表）、凭据解析（配置值 → env）、15s 超时与重试、5 分钟定时刷新 + 手动刷新；通过 `harness.handle('fee-panel/refresh' | 'fee-panel/get-state' | 'fee-panel/set-key')` 暴露 Package 私有 RPC。
- **Client**：注册两个 Slot：
  - `sidebar.footer.action`（list 型）→ 底部紧凑费用条（设计稿 §4）。
  - `settings.section`（list 型，label「费用展示」）→ 独立配置页（设计稿 §5）。
- Client 通过 `host.call` 拉取快照；Key 输入经 `host.call('fee-panel/set-key', ...)` 传到 Host 内存。
- 状态快照模型（Host 持有，Client 渲染）：

```json
{
  "providers": [
    {
      "id": "zai | kimi | deepseek | mimo",
      "status": "ok | stale | error | no-key | loading",
      "kind": "quota | balance",
      "primary": { "label": "5h", "percentUsed": 1.0 },
      "secondary": { "label": "余额", "text": "¥49.12" },
      "resetsAt": "ISO 或空",
      "credentialSource": "config | env | none",
      "updatedAt": "ISO",
      "error": "软错误摘要（不含 Key）"
    }
  ]
}
```

## 4. 侧边栏底部设计稿（紧凑模式）

可视化见 `fee-panel-mockup.html`。规格：

```
┌──────────────────────────────┐  ← 容器卡片：圆角 10px、浅色面板底 + 1px 描边，
│ ┌────────────┐ ┌───────────┐ │     内边距约 7px 9px（无标题行）
│ │ Z.ai   1%  │ │ Kimi   0% │ │  ← 磁贴 2×2：上行 名称+数值(等宽数字)，
│ │ ▓░░░░░░░░░ │ │ ▓░░░░░░░░ │ │     下行 3px 进度条（余额型显示「余额」小字）
│ └────────────┘ └───────────┘ │
│ ┌────────────┐ ┌───────────┐ │
│ │ DS  ¥8.20  │ │ MiMo    — │ │  ← 余额直接展示；未配置凭据显示 —
│ │ 余额        │ │ 未配置    │ │
│ └────────────┘ └───────────┘ │
└──────────────────────────────┘
     总高 ≈ 88px（两行磁贴 2×40 + 间距）
```

- **磁贴状态**：
  - `ok`：数值正常色；配额型进度条 <70% 品牌青、70–90% 琥珀、>90% 红。
  - `stale`（>10 分钟未刷新成功）：整体 60% 透明度 + 数值前加 `⏱`，tooltip 注明上次成功时间。
  - `error`：数值位显示 `!`，tooltip 显示软错误摘要。
  - `no-key`：显示 `— ⚙`，tooltip「未配置 Key，点击设置」。
  - `loading`：骨架条闪烁（仅首次，之后保留旧值）。
- **交互**：hover 磁贴出 Tooltip（完整窗口明细、reset 时刻、凭据来源）；**点击磁贴 = 刷新该供应商**（刷新中数值脉动动画）；设置入口在 设置 → 费用展示（页面内含各供应商显示勾选）。
- 侧栏折叠为窄轨时退化为单列竖排 4 个迷你点（色点+数值），与 cost-meter 的 rail 模式同思路。

## 5. 配置页面设计稿（设置 → 费用展示）

- 入口：设置页新增一个 section「费用展示」（icon 💰）。页面内容 = 4 张供应商卡片 + 全局刷新设置。
- 每张卡片结构：

```
┌─────────────────────────────────────────────────────┐
│ Z.ai / 智谱 GLM Coding Plan        [订阅配额] ●正常  │
│ API Key  [ ●●●●●●●●●●●●  👁 ]   [保存] [测试] [清除] │
│ 当前来源：环境变量 BIGMODEL_API_KEY（自定义未设置）    │
│ 提示：Coding Plan 专属 Key，z.ai / bigmodel.cn 控制台 │
│ 最近测试：余额窗口 5h 已用 1% · 12:30 ✓               │
└─────────────────────────────────────────────────────┘
```

- 字段规则：
  - Key 输入框 `type=password`，👁 切换明文；placeholder 动态显示回落值，如「未设置，将使用环境变量 ZAI_API_KEY」。
  - 「当前来源」一行三态：`自定义 Key（sk-…a1b2）` / `环境变量 XXX` / `未配置`。
  - 「测试」按钮即时调用 Host fetcher，成功显示摘要，失败显示软错误（401 = Key 无效、网络错误等）。
  - 「清除」删除自定义 Key，回落 env。
- **MiMo 卡片特例**：输入框换成多行「Cookie」粘贴框，附帮助文案（登录 platform.xiaomimimo.com → 控制台 → F12 复制 Cookie 头），并说明需要 `api-platform_serviceToken` 与 `userId` 两个 Cookie。
- Kimi 卡片注明两类 Key 的区别（`sk-kimi-*` 订阅 Key 显示配额窗口；开放平台 Key 只显示 PAYG 余额）。
- 全局区：自动刷新间隔（默认 5 分钟，1–60 可选）、「全部刷新」按钮。

## 6. 与 dsh-cost-meter 的关系

- 不读取、不依赖 cost-meter 的运行时状态；仅复用其已验证的**端点、请求头、凭据 env 名与解析语义**（见 §2 表）。
- 可同时安装不冲突（两者各占 `sidebar.footer.action` 一个 entry）；如需替换，在「扩展管理」停用 cost-meter 即可。
- 精简掉的能力（本插件不做）：账单流水 ledger、会话成本分摊、composer 顶部 quota strip、网关多账号、CSV 导出等。

## 7. 待确认项

1. MiMo 走 Cookie 是否可接受？（无 API-Key 端点是平台限制，不是设计选择）
2. 紧凑模式默认 2×2 网格 OK？还是更希望保持一行一条目（更高但信息更全）？
3. 自定义 Key 只存内存、重启丢失回落 env——可接受？（动态插件不宜落盘 Key）
