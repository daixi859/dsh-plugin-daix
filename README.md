# dsh-plugin-daix

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件 —— 一个 pnpm workspace 仓库，含一个独立可装卸的插件包：

| 插件包 | 功能 |
|---|---|
| [`dsh-skill-manager`](./dsh-skill-manager) | 设置页里管理全局/项目技能的启用与禁用（写 SKILL.md frontmatter），支持切换工作区管理其项目技能 |

## 仓库结构

```
dsh-plugin-daix/
├── pnpm-workspace.yaml      # dsh-skill-manager 组成 workspace
├── package.json             # 根包：private，仅作 workspace 壳
└── dsh-skill-manager/       # 插件：零依赖（node:fs + host 服务）
```

插件包自带官方分发声明：`dsh.bundle.patch` → 包内 `cordis.patch.yml`，
`dsh.client` → 浏览器端 `__ModuleLoader__` bundle。

## 首次准备

```bash
git clone <repo> dsh-plugin-daix
cd dsh-plugin-daix
pnpm install        # 零运行时依赖，仅同步 workspace 壳
```

## 安装 / 卸载（官方 profile-bundle 机制）

```bash
# 本地路径安装（在仓库根目录执行；dsh 会把相对路径锚定到当前目录）
dsh plugin --profile web add ./dsh-skill-manager
# 之后重启 dsh web 并刷新浏览器

# 卸载
dsh plugin --profile web remove dsh-skill-manager
```

判断依据是包内 `dsh.bundle` 声明：`add` 后 reconcile 自动进入
`dsh.profile.bundles` 层列表，`remove` 自动移除，无需手改 profile 任何文件。

从 git 远端安装（不落地整个仓库到本地依赖树）也走同一条命令，用
pnpm 的子目录语法：`dsh plugin --profile web add "github:<user>/dsh-plugin-daix#path:dsh-skill-manager"`。

## 开发工作流

- 插件包以 `link:` 挂载，源码改动即时可见；但 bundle/client 元数据在
  dsh 进程内有缓存 —— **改完重启 `dsh web` + 强刷浏览器**。
- 验证组合树：`dsh web --dump-config`，应看到插件一行 `# == dsh-skill-manager` 层、
  一行 `- id: skill-manager`，无重复。

## 已验证

- `dsh web --dump-config`：插件挂载一次，无重复行
- profile（`~/.dsh/profiles/web`）→ 包的 `link:` 指向本仓库子目录，workspace 化后不变
- 目标部署 DSH `0.1.5-rc.x`：`settings.section` slot、`locale` 服务、
  `webServer` 路由、`skills.snapshot`/`agents` host 契约均未变化

## 使用方式
```
# 克隆后一次装完
pnpm install
# 装进 web profile（在仓库根执行）
dsh plugin --profile web add ./dsh-skill-manager
# 远端安装（不整库落地）
dsh plugin --profile web add "github:<user>/dsh-plugin-daix#path:dsh-skill-manager"
```
