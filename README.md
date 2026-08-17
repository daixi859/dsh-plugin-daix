# dsh-plugin-daix

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件合集 —— 一个 pnpm workspace 仓库，含三个独立可装卸的插件包：

| 插件包 | 功能 |
|---|---|
| [`dsh-skill-manager`](./dsh-skill-manager) | 设置页里管理全局/项目技能的启用与禁用（写 SKILL.md frontmatter） |
| [`dsh-usage-suite`](./dsh-usage-suite) | 输入框 dock 显示当前 provider 用量：OpenCode Go / DeepSeek 余额 / GLM Coding Plan 配额 |
| [`dsh-vision-suite`](./dsh-vision-suite) | 粘贴/拖入图片转路径 + `recognize_image` 识图工具（OpenAI 兼容视觉 API） |

## 仓库结构

```
dsh-plugin-daix/
├── pnpm-workspace.yaml      # 三个插件包组成 workspace
├── package.json             # 根包：private，仅作 workspace 壳
├── dsh-skill-manager/       # 插件：零依赖（node:fs + host 服务）
├── dsh-usage-suite/         # 插件：零依赖（node 内建 + fetch）
└── dsh-vision-suite/        # 插件：依赖 dsh-tools / schemastery（host 侧运行时导入）
```

每个插件包自带官方分发声明：`dsh.bundle.patch` → 包内 `cordis.patch.yml`，
`dsh.client` → 浏览器端 `__ModuleLoader__` bundle。三个包相互独立，可单独装卸。

## 首次准备

```bash
git clone <repo> dsh-plugin-daix
cd dsh-plugin-daix
pnpm install        # 一次装完整个 workspace（主要是 vision-suite 的 host 侧依赖）
```

> vision-suite 的 `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` 必须能从
> 本仓库真实路径解析（profile 的 `link:` 不会代为安装），workspace 化后由根
> `pnpm install` 统一落盘到各包 `node_modules`。

## 安装 / 卸载（官方 profile-bundle 机制）

```bash
# 本地路径安装（在仓库根目录执行；dsh 会把相对路径锚定到当前目录）
dsh plugin --profile web add ./dsh-skill-manager
dsh plugin --profile web add ./dsh-usage-suite
dsh plugin --profile web add ./dsh-vision-suite
# 之后重启 dsh web 并刷新浏览器

# 卸载任意一个
dsh plugin --profile web remove dsh-vision-suite
```

判断依据是包内 `dsh.bundle` 声明：`add` 后 reconcile 自动进入
`dsh.profile.bundles` 层列表，`remove` 自动移除，无需手改 profile 任何文件。

从 git 远端安装单个插件（不落地整个仓库到本地依赖树）也走同一条命令，用
pnpm 的子目录语法：`dsh plugin --profile web add "github:<user>/dsh-plugin-daix#path:dsh-vision-suite"`。

## 开发工作流

- 三个包都是 `link:` 挂载，源码改动即时可见；但 bundle/client 元数据在
  dsh 进程内有缓存 —— **改完重启 `dsh web` + 强刷浏览器**。
- 验证组合树：`dsh web --dump-config`，应看到每个插件一个 `# == <包名>` 层、
  各一行 `- id: <插件id>`，无重复。
- usage-suite 的 `test-*.mjs` 是独立脚本（`node test-parse.mjs` 等），不依赖
  任何外部包，随仓库保留。

## 已验证

- `dsh web --dump-config`：三个插件各挂载一次，无重复行
- profile（`~/.dsh/profiles/web`）→ 三个包的 `link:` 指向本仓库子目录，workspace 化后不变
- 从 profile 解析锚点导入三个 host 入口（含 vision-suite 的运行时依赖链）全部通过
