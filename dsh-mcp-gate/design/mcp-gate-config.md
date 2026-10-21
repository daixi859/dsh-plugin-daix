# dsh-mcp-gate · MCP 管理配置页面设计草图

可视化草图：[mcp-gate-config-sketch.html](./mcp-gate-config-sketch.html)（自包含，浏览器直接打开可交互演示；颜色用 `--dsw-alias-*` token，嵌入 DSH 后自动贴合主题）。

## 分层配置模型（对应三条需求）

全局层 `~/.dsh/plugins/mcp-gate/config.json`：

```jsonc
{
  "mcpEnabled": true,                  // 需求① 整体开关（硬开关）
  "servers": {
    "github": {
      "enabled": true,                 // 全局默认
      "exposure": "deferred",          // pi 四级：codemode | deferred | direct | hidden
      "toolExposure": { "search_code": "direct" }
    }
  }
}
```

项目层 `<工作区>/.dsh/mcp-gate.json`（只写覆盖项，其余继承全局）：

```jsonc
{
  "servers": {
    "github": { "enabled": false },    // 需求② 全局开 → 本项目关
    "sentry":  { "enabled": true }     // 需求③ 全局关 → 本项目开
  }
}
```

有效状态计算：

```
enabled_eff  = mcpEnabled && (project.enabled ?? global.enabled)
exposure_eff = project.exposure ?? global.toolExposure[tool] ?? global.exposure
```

## UI 与需求映射

| 需求 | 控件 |
|---|---|
| ① 整体开关 | 头部 master 开关；关闭 → 红色横幅 + 列表置灰、所有覆盖暂不生效 |
| 单服务器全局开关 | 行内「全局」switch 直接切 `servers[n].enabled`，写全局配置文件 |
| ② 全局开 → 项目关 | 行内三态组点「项目关」，行标 `⚠ 本项目已关闭`（黄） |
| ③ 全局关 → 项目开 | 三态组点「项目开」，行标 `↑ 仅本项目启用`（绿） |
| 暴露模式（pi 设计） | 行展开：exposure 四段 segmented + per-tool「覆盖」按钮循环切换 |
| 项目隔离 | 顶部项目选择器切换工作区；覆盖按项目独立，元信息条显示覆盖计数 |
| 查找 | 过滤 tab：全部 / 已启用 / 已禁用 / 本项目覆盖 |

## 交互规则

- 行内自左向右三层可读：状态点（生效结果）→「全局」switch（全局默认启用/禁用）→ 三态点击组（**继承 / 项目开 / 项目关**，一点即达，无下拉）；非继承态整组描黄边，覆盖提示并入描述行。
- 变更即时写盘：全局改动写 `config.json`，项目改动写该工作区的 `mcp-gate.json`；host 面 `tools.restrict` 谓词更新，下一轮请求生效。
- 行头状态点：绿=生效中，灰=未生效；`direct` 服务器在行名旁重复显示 direct badge，提示「该服务器全量声明，不经披露」。
- 页脚注明：tool_search 的会话内解锁是瞬态，不在此页管理。

## 待定

1. **master 语义**：当前设计为硬开关（关 → 全部停用）。若想要「默认关、项目可例外」，把 `mcpEnabled` 降级为默认值并允许项目覆盖推翻即可，页面结构不变。
2. `exposure` 编辑是否全局/项目两级都可写（草图仅演示全局级）。
