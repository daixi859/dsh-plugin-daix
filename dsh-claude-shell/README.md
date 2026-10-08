# dsh-claude-shell

给 DeepSeek Harness 网页界面换上 Claude Code 风格外壳的主题插件：侧边栏、视图标签条与会话标题栏三块界面由插件接管，输入区与对话区保持 Harness 原样。

## 功能

| 功能 | 开关 | 说明 |
|---|---|---|
| 侧边栏 | 折叠侧栏设置区 | 品牌标记、新建会话按钮、插件条目与工作区/会话行按 Claude Code 的比例重排；侧栏底部的设置入口收进账号弹层 |
| 视图标签条 | 对话 / 轨迹标签条 | 对话区顶部标签条重画为分段控件，放得下时抬到标题行 |
| 标题进入顶栏 | 会话标题进入顶栏 | 桌面端把会话标题与顶栏控件抬进系统标题栏，放不下的一侧留在原行 |
| 主题与字体 | 品牌标识 / 配色 / 字体 | 象牙白与暖黑双画布、陶烬橙强调色、JetBrains Mono 代码字体 |
| 亮暗切换 | 无开关 | 切换亮色与暗色时边框、阴影与底色在同一帧换好 |

品牌标识与配色是两项独立的设置：品牌标识决定侧边栏与账号头像画哪一个标记（Claude 的星芒与字标，或 DeepSeek 的鲸鱼），配色决定界面上所有颜色——自带的两套配色（Claude 暖色、DeepSeek 蓝色）任选其一，或交还宿主。字体的归属同样独立：用插件自带的字体，或跟随宿主。

每个开关都在设置对话框的「Claude Shell」分页与插件页上，关闭后宿主原来的界面立即回来，不需要刷新页面。

## 安装

```sh
npm install          # 开发依赖
npm run build        # 生成 lib/：客户端 bundle、宿主半边、字体与文案文档
```

把本目录作为 bundle 装进 DSH 的 profile 后，`cordis.patch.yml` 会把它插进网页插件名册；构建产物全部在 `lib/`，不进入版本控制。

## 结构

- `packages/client/src/core/` 宿主访问、偏好、文案、调度器与观察总线，单元测试放在模块旁边
- `packages/client/src/features/<功能>/` 每个功能一个目录：主模块导出 `install(ctx, ui)`，旁边的 `<主模块>.manifest.ts` 声明顺序、开关、样式表与设置行
- `packages/client/src/theme/` 不属于任何功能的整体外观与设计令牌（`tokens.json`）
- `packages/assets/` 品牌图形与随包字体
- `packages/contracts/` 两半共用的宿主契约、服务形状、偏好表与路由
- `packages/host/src/` 手写的宿主半边：文案文档、字体、系统用户名、HDSL 账号与会话删除五条私有路由

## 命令

```sh
npm run build    # 类型检查、打包、样式表检查，写出 lib/
npm test         # 单元测试：Vitest 浏览器模式，驱动本机 Chrome/Edge（CHROME_PATH 可指定）
```
