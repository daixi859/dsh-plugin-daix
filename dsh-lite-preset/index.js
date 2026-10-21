/**
 * Lite preset 专属工具遮蔽(Host 插件,无 Config)。
 *
 * preset 的 plugins 是挂载声明而非白名单:working_directory 由基座层
 * (dsh-base)无条件挂载,YAML patch 的 disabled 只能全局生效。本插件
 * 随 lite preset 在其 standing scope 上激活,调用 ctx.tools.restrict
 * 打 deny mask——mask 只作用于加入 lite preset 的会话,standard 等
 * 其他模式不受影响。working-directory 服务行不在 deny 名单内,
 * cwd 注入与持久 cd 照常。
 */
const name = 'lite-tool-shield'

const inject = ['tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - lite preset 的 standing scope 上下文。
 */
function apply(ctx) {
  ctx.tools.restrict({ deny: ['working_directory'] })
}

export { apply, inject, name }
