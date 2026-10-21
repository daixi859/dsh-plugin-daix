# dsh-claude-lite

最简 Claude Code 风格皮肤插件：只画侧边栏与标题带，对话区与输入区保持宿主原样。

## 它做什么

- **侧边栏**：按 Claude Code 桌面端重绘——28px 统一行规格、新会话行右侧圆形加号片（悬停旋转 90° 变强调色）、区块小标题、会话行悬停显操作钮、页脚细分隔线、细滚动条。紧凑规格为默认。
- **标题带**：Windows 上把对话区标题与视图页签抬进系统标题栏（Window Controls Overlay 量算），放不下时自动落回页头。Web 页与 macOS 不抬。
- **主题**：`claude`（暗，默认）/ `claude-light`（亮）/ `host`（跟随宿主）。配色取自 dsh-claude-style 的 claude 档令牌。
- **配置**：设置页四个字段——主题、强调色、侧栏底色、画布底色（后三者留空即用令牌默认）。

## 它不做什么

不画对话区、输入区、消息流、代码块；不换字体；不做品牌替换、ongoing 呼吸点、设置页自有路由。两份皮肤（dsh-claude-style / dsh-claude-lite）同时只能启用一份——启用本插件时在档案补丁里禁用 style。

## 架构

```
src/client/
  constants.ts        槽选择器、属性名、PREF_VARS
  entry.ts            装配序：皮肤标记 → 镜像 → 样式表 → 走查 → 标题带
  core/               bus（rAF 双相队列）、prefs（configForms 镜像）、stylesheet、host 契约
  engine/             parts-table（宿主局部名→part 名词表）、parts（打戳走查）、
                      dom（哈希类解析）、desktop-band（overlay 量算）、band（几何发布）
  theme/              tokens.css（令牌与门）、band.css、sidebar.css
src/host/index.js     Config（schemastery，零编译 ESM）
```

机制与 dsh-claude-style 同源：引擎把宿主 CSS-module 局部名（`logoRow`、`sessionRow`…）翻译成皮肤自己的 part 名，写 `data-dsh-lite-part` 属性；样式表只认这个属性，宿主改名只需改词表一处。定位锚是宿主稳定的 `data-slot` 槽（`root` / `sidebar` / `conversation.header`），不碰哈希类子串。

## 构建

```
pnpm install --ignore-workspace
node scripts/build.mjs     # lib/client.js（esbuild 内联 CSS）+ lib/host/index.js
node scripts/smoke.mjs     # vm 桩冒烟：装载/装配/镜像/卸载
```

## 安装（desktop 档案）

1. `C:\Users\DELL\.dsh\profiles\desktop\package.json` 依赖加 `"dsh-claude-lite": "link:D:/wsl/dsh-plugin-daix/dsh-claude-lite"`；
2. `node_modules` 下建同名符号链接指向本目录；
3. 档案 `cordis.patch.yml` 追加 `ui-skin-claude-lite` 条目，并给 `ui-skin-claude-style` 追加 `disabled: true`；
4. 重启 DeepSeek Harness GUI。
