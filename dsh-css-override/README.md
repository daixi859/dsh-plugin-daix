# dsh-css-override

给 DeepSeek Harness 网页界面加一份**自己的 CSS**：在设置里维护多条规则，每条规则就是一段 CSS 文本；勾选启用的规则按列表顺序拼成一份样式表，追加到页面 `<body>` 末尾，覆盖应用自带样式。

## 功能

- **规则可增删改**：新建 / 重命名 / 复制 / 删除；一条规则只有两样东西——**名字**和**一段 CSS**。名字在规则行上点一下就改。
- **开关就是注入开关**：只有开启的规则进入页面；关闭后立即从页面撤掉，但规则内容保留。
- **所见即所得**：展开规则后在行内编辑器里改，带行号与 CSS 语法高亮；编辑器里只有 CSS 这一个输入区。点「应用」（或 `Ctrl+Enter`、或点别处失焦）立即生效。
- **落盘持久化**：所有规则写进 `$DSH_HOME/css-override/rules.json`（原子写：先写临时文件再改名）。重装插件、重建 profile 都不会丢。
- **离线兜底**：宿主不可达时用浏览器 `localStorage` 兜住，服务恢复后以文件为准。
- **导出与定位**：可把合并后的样式表导出成 `dsh-css-override.css`；设置页显示真实文件路径，支持复制路径与在文件管理器中打开。
- **多窗口收敛**：切回本窗口时重新读取文件；文件被手工改动导致版本冲突时拒绝覆盖并重新载入。

## 位置

设置 → 插件 → **CSS 覆盖** 页签。

## 规则文件

```jsonc
// $DSH_HOME/css-override/rules.json
{
  "version": 1,
  "revision": 12,
  "savedAt": "2026-09-25T12:58:27.536Z",
  "rules": [
    {
      "id": "r1",
      "name": "侧边栏深色",
      "css": "aside { background: #101828 !important; }",
      "enabled": true,
      "updatedAt": "2026-09-25T12:58:27.521Z"
    }
  ]
}
```

- `revision` 用于写冲突检测：浏览器带着自己读到 `revision` 提交，文件已被别人改过就返回 409 而不是覆盖。
- 手上改这个文件也可以（下次打开设置页或切回窗口时重新载入）；`DSH_CSS_OVERRIDE_HOME` 可改存放目录。
- 早期版本还有 `label` / `hint` 两个字段（曾在编辑器里显示为两个输入框，与「名字」重复，已从界面移除）。宿主仍然**接受并原样保留**它们，所以旧文件不会因为打开一次就被改写；新写的规则不再带这两个字段。

## 工作原理

1. 浏览器半启动时先读 `localStorage` 影子（刷新后立刻恢复样式），再 `GET /api/dsh-css-override/load` 与文件对齐。
2. 所有启用规则由 `buildCss()` 拼成一份样式表，写进 `<body>` 末尾的**唯一**一个 `<style data-plugin-css="dsh-css-override/rules">`。放在 body 末尾意味着它在应用自己的样式表之后，同优先级下后者胜出。
3. 任何改动都先落到内存并立即重绘样式表，再经 `POST /api/dsh-css-override/save` 写文件；所有往返排在同一条 promise 队列上，慢查询不会覆盖新编辑。
4. 宿主半只用 Node 内置模块，浏览器半只依赖平台提供的 `react`——零依赖、零构建。

### 界面样式为什么这么写

设置面板是应用自己的样式表在管，插件不能假设宿主没有全局元素规则，所以本插件的样式表做了两件事：

- 所有控件类名以 `dco_` 开头，并且用 `[class^="dco_"],[class*=" dco_"]` 统一压 `box-sizing:border-box`——属性选择器比宿主的裸元素选择器（`button`、`input`、`textarea`）优先级高，宿主的基础样式无法把控件撑高或撑宽。
- 每个可交互控件显式锁定 `height` / `line-height` / `font-family` / `font-size`（按钮 30px、图标按钮 26px、输入框 32px、编辑区 150px）。
- 展开的编辑器是 `.dco_item` 里 `.dco_row` 的**兄弟节点**，不是网格单元——否则它会被塞进中间那一栏，所有控件只剩 350px 宽。
- 整页 `max-width:760px`，与设置面板里其他页的阅读宽度一致。

改样式后请同时跑 `test/browser-check.ps1`：它会打印每个控件的实测尺寸与被命中的规则，样式回归一眼可见。

## 边界

- 选择器要命中应用里真实的类名（`F12` 取元素 → 复制 selector）；写错的选择器只是不生效，不会报错。
- 同优先级下后写的规则胜出；内联 `style` 只能靠 `!important` 覆盖（部分内联属性仍无法覆盖）。
- 设置页里的语法高亮是轻量 tokenizer，只为可读性，不影响注入的 CSS 原文。
- 规则上限 200 条、单条 CSS 200 KB。

## 开发与验证

```sh
# 安装（本地开发用 link，改完刷新页面即可）
dsh plugin --profile web add <本目录绝对路径>
```

```sh
# ① 单元：规则归一化（旧字段保留、新规则字段集、坏数据兜底）
node test/unit-normalize.mjs

# ② 无头桩环境：真实 client bundle + 桩 DOM/React + 真实宿主路由
node test/harness.mjs

# ③ 真实浏览器：headless Chrome/Edge 跑同一份 bundle，出结论 + 截图
pwsh -NoProfile -File test/browser-check.ps1
#   -> 47 项检查 + test/artifacts/settings-page.png（渲染出来的设置页）

# ④ 全新加载的持久化证明：写盘 → 新开浏览器零交互读取
pwsh -NoProfile -File test/persist-check.ps1
```

`test/harness.mjs`（28 项）覆盖：注入位置（唯一 `<style>`，且是 `<body>` 最后一个**元素**子节点）、启动读取、规则名注释、设置页渲染（标题/按钮/规则名/徽标/落盘路径/状态灯）、开关切换后注入样式表与磁盘同步、再次切换后恢复、展开编辑器、卸载时清理。

`test/browser-check.ps1`（36 项）在真实引擎里额外证明：`getComputedStyle` 显示注入的 `!important` 规则压过了行内样式；页面有真实布局（1232×493，非零）；开关 / 展开 / 编辑器（行号 + 34 个高亮 token）都是真实 DOM；点击开关后样式表与磁盘一起变化，随后把规则文件恢复原状。

浏览器检查会临时改写规则文件再还原（`revision` 因此会前进几次），属预期行为。

**未覆盖**：设置面板在 GUI 里的实际停靠位置与视觉精修 —— 需要人眼在 http://127.0.0.1:3080 确认（设置 → 插件 → CSS 覆盖）。
