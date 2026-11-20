# ADR 0001：Markdown 渲染复用基线模块 MarkdownText，而不是自带解析器

- 状态：已采纳
- 日期：2026-11-21

## 背景

便签展开态要渲染 Markdown。最初实现了一个约 130 行的自写解析器（标题/列表/引用/代码块/行内标记/链接）。

自写解析器与对话区的渲染结果对不上：表格、任务列表、删除线、自动链接、KaTeX 公式、代码高亮、脚注都不支持；同一段 Markdown 在对话里和在便签里长得不一样。

## 决定

在客户端 bundle 里 `require("@deepseek-ai/dsh-client-ui-primitives")`，用它的 `MarkdownText` 渲染便签正文。删掉自写解析器。

## 依据

- 该模块在宿主 `PLATFORM_MODULES` 里（`packages/client/web/src/platform.ts`），是给所有客户端插件的基线段共享模块，与对话区用的是**同一份**实例。
- 因此便签里的 Markdown 与对话里逐像素一致，且随宿主的渲染能力升级自动跟进。
- 它是基线模块，所以**不能**写进 `dsh.client.external`（那是给基座之外的精确请求用的），也不需要打包进插件。

## 备选与代价

- **vendored markdown-it / remark**：体积大、样式要自己接、KaTeX 与 shiki 还得单独配，且永远与对话区有差异。
- **继续自写**：就是被替换掉的那版，能力缺口无法补齐。

代价：插件从此依赖宿主的这个模块存在。运行时取不到时降级为纯文本 `<pre>`，不会白屏；`test/guard.test.mjs` 锁住「不许再出现自写解析器」。

## 后果

- 展开态不再由插件提供块级 Markdown 样式，排版由 `MarkdownText` 自己的主题 token 决定。
- 折叠态仍是纯文本 4 行截断（`-webkit-line-clamp` 装不下块级 Markdown），两种形态的切换只发生在展开/收起。
