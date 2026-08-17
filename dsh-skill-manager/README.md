# dsh-skill-manager

在 DSH 设置（Settings）中管理**全局**与**项目**技能的启用/禁用：

- **全局技能**：`~/.dsh/skills`、`~/.agents/skills`（用户级）
- **项目技能**：`<workspace>/.dsh/skills`、`<workspace>/.agents/skills`（跟随当前工作区）
- **内置技能**：部署自带（bundled/custom），只读展示，不可修改

## 功能

- 设置页新增 **"技能管理"** 入口（`settings.section`，order 25）
- 每个全局/项目 skill 一个启用开关
- 禁用 = 向 `SKILL.md` frontmatter 写入 `disable-model-invocation: true` + `user-invocable: false`
  —— skill 立即从模型目录（`available_skills`）与 `/名称` 手势中消失，文件保留
- 启用 = 移除这两个字段，skill 恢复可见
- 状态持久化在 SKILL.md 文件本身，重启 DSH 后依然生效

## 结构（官方 bundle 插件规范）

```
dsh-skill-manager/
├── package.json        # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml    # 向 host 组合插入 skill-manager 插件行
└── lib/
    ├── index.js        # host 面：webServer HTTP 路由 + node:fs 读写 skill 文件
    └── client.js       # client 面：__ModuleLoader__ CJS bundle，设置页 UI
```

- Host 面遵循官方函数插件四要素（`name`/`inject`/`Config`/`apply`）
- 插件自有簿记直接使用 `node:fs`（官方文档明确不走沙箱 fs 服务），因此可写任意全局目录
- 数据通道为官方 webServer HTTP 路由：
  - `GET  /plugins/skill-manager/list`
  - `POST /plugins/skill-manager/set-enabled`

## 安装

```sh
# 在插件目录构建（本插件纯 JS，无需构建步骤）
# 安装到 web profile（dsh plugin 会在 profile 目录转发 pnpm 并 reconcile bundles 层）
npx -p @deepseek-ai/dsh dsh plugin --profile web add D:\wsl\dsh-plugin-daix\dsh-skill-manager
# 或从任意目录使用已安装的 dsh：
#   dsh plugin --profile web add <本插件绝对路径>

# 重启 profile 后生效（bundle 与 client 元数据在进程内缓存）
```

安装后：
- profile 的 `package.json` 出现 `dsh-skill-manager` 依赖
- `dsh.profile.bundles` 层列表加入 `dsh-skill-manager`（`dsh.bundle` 声明触发 reconcile）
- 重启 DSH 后，设置页出现 **技能管理**

## 卸载

```sh
dsh plugin --profile web remove dsh-skill-manager
# 重启 profile 后生效
```

卸载会移除依赖与 bundles 层条目；skill 文件本身不受影响。

## 验证

```sh
# 组合树中出现插件行（离线，不启动服务）
dsh --profile web --dump-config | grep -A2 skill-manager
```
