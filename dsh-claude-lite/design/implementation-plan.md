# dsh-claude-lite 实现方案

与设计稿 [claude-lite-mockup.html](claude-lite-mockup.html) 配套。设计规格（度量与配色）以设计稿下方「设计规格」表为准，本文只写工程方案。

## 边界

- 只绘制两处：**侧边栏**、**标题栏带**（对话区标题 + 视图页签抬入系统标题栏）。
- 对话区与输入区不写任何规则，保持宿主原样。
- 与 dsh-claude-style 互斥：档案补丁里启用本插件时禁用 style；运行时若读到 `data-dsh-skin`（宿主皮肤中心标记另一皮肤在页）则不落笔。
- 包名 `dsh-claude-lite`，样式戳记用 `data-dsh-lite-part`（避开 style 的 `data-dsh-claude-part`，两套皮肤同页也不串）。

## 定位契约（取自 dsh-claude-style contracts/src/dom.ts，2026-10-20 仍与宿主 0.2.1-rc.2 核对）

锚点（宿主稳定属性，引擎只认这些）：

| 锚点 | 用途 |
| --- | --- |
| `[data-slot="root"]` | 壳框架根，三列在其中 |
| `[data-slot="sidebar"]` | 侧边栏槽锚，其直接子元素是 `sidebar-root` 列盒 |
| `[data-slot="conversation.header"]` | 对话区页头槽锚，标题行与页签在其中 |
| `--dsh-frame-top-clearance` | 桌面壳声明在文档元素上的标题栏让位高度，标题栏带的行高读它 |
| `data-windows-titlebar` / `data-windows-menu` / `data-platform` / `data-fullscreen` | Windows 标题栏存在性、原生菜单座位、平台、全屏 |
| `data-ds-dark-theme`（body） | 宿主明暗翻转 |
| `data-dsh-skin` | 皮肤中心标记，存在即让位 |

引擎走查后打戳（样式表只读戳记，绝不写宿主哈希类）：

| 戳记（data-dsh-lite-part~） | 位置 |
| --- | --- |
| `sidebar-root` | `[data-slot="sidebar"]` 的直接子列盒 |
| `logo-row` / `brand-button` / `sidebar-toggle` | 侧栏顶行（桌面壳下 toggle 由标题栏带收编） |
| `search-slot` / `panel rows` / `section headers` | 侧栏搜索与面板行（走查时按 `data-slot` 槽锚逐格登记） |
| `foot-area` / `settings-area` / `footer-actions` | 侧栏页脚 |
| `conversation-header` / `title-row` / `header-title` / `header-utilities` / `header-corner` | 对话区页头各件（`title-row` 用 `closest` 反查页头，不做全文档匹配） |
| `view-tabs` | 页头条 |

## 结构（仿 dsh-claude-shell 减掉多余件）

```
dsh-claude-lite/
  package.json            # dsh 插件清单，peer 依赖按 shell 的写法
  packages/
    client/               # 引擎走查 + 打戳 + 注入样式表（theme/）
      src/theme/
        tokens.css        # claude 档令牌（取 style tokens.json）：亮暗两套 + 品牌戳
        sidebar.css       # 侧栏重绘（设计稿②）
        band.css          # 标题栏带（设计稿①）：标题 + 页签抬入 caption 区
    host/                 # 设置：品牌标记、配色，一页两行（设计稿④）
    assets/               # Claude 十二芒星 / DeepSeek 鲸两枚 SVG 标记
```

不做：settings 多页、account 接管、theme-flip 整页翻色、typography、钠引擎、第三方兼容表——shell 有而本插件不需要的全砍。

## 配置

```
brand:  "claude" | "deepseek"   # 品牌标记（默认 claude）
palette: "dark" | "light" | "host"  # 配色档（默认 host）
```

## 三个待确认问题（未答复则按默认实现，均为小改动可后调）

1. 品牌区文字：默认**只换图形标记，保留宿主产品名文字**。
2. 页签溢出：默认**溢出隐藏**（现稿行为）。
3. 配色第二档：默认**「跟随宿主」**（palette: host 时插件不写颜色，只写布局；dark/light 两档用 claude 配色）。

## 风险

- 客户端检查通道（Slots/Theme）本轮不通，宿主槽名以 style 契约表为准；实现后需在真机 GUI 上逐格核对戳记是否全部落上。
- `--dsh-frame-top-clearance` 仅桌面壳声明；web 平台（data-platform 无桌面值）时标题栏带退化为普通顶行，不占 caption。
