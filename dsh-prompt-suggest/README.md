# dsh-prompt-suggest

输入框底部工具行的提示词建议按钮：一键生成中文提示词建议；已有草稿时润色草稿并在可编辑卡片中确认后替换。

## 功能

- **生成建议**（输入框为空时点击按钮）：用当前会话的模型，基于最近一轮对话生成一行中文指令建议，直接填入输入框。
- **润色草稿**（输入框有草稿时点击按钮 / 右键按钮）：把当前草稿交给模型润色，结果先弹进可编辑卡片——`Ctrl+Enter`（或点"替换草稿"）保存替换，`Esc` / 取消丢弃不动原文。
- 模型跟随当前会话选择（`modelSelection` 投影的 `next ?? lastUsed`），不引入额外配置。

## 位置

- 按钮：`conversation.input.right`（composer 工具行、提交按钮前的紧凑控件区；会话内才渲染）。
- 编辑卡片：`shell.overlay`（frame 顶层）。

## 数据通道

client 面点击按钮后 `POST /plugins/prompt-suggest/generate`：

```json
{ "sessionId": "...", "draft": "...", "provider": "...", "model": "...", "reasoningEffort": "..." }
```

host 面流程：`sessionQuery.readSurface(sessionId)` 取最近一轮 user/assistant 文本（user 尾 2000 / assistant 尾 8000 字符，Pendant 同参数）→ 组装固定中文 meta-prompt → `llm.prepareCall` + `stream` 一次辅助调用（20s 超时，建议 ≤256 tokens / 润色 ≤4096 tokens）→ 清洗（剥包裹引号、建议模式取首行 ≤300 字符且不与草稿雷同）→ 返回文本。

失败时按钮亮红点，悬停显示错误；详细错误写入 `~/.dsh/storages/prompt-suggest/last-error.json`。

## 安装

```
dsh plugin --profile <name> add dsh-prompt-suggest
```

## 测试

```
node --test dsh-prompt-suggest/test/prompt.test.mjs
```
