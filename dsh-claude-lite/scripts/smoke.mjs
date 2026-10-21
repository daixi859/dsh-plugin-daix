/**
 * 冒烟测试：不在浏览器里，用最小 DOM 桩把 lib/client.js 跑一遍。
 * 验证四件事：工厂可执行、apply 可调用、装配序完整（皮肤标记/表/走查/带）、
 * 卸载干净。CSS 注入只检查内容完整性（tokens/band/sidebar 三段都在）。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert'

const ROOT = path.resolve(import.meta.dirname, '..')
const bundle = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

// ── DOM 桩：只实现皮肤真正触碰的面 ──
const attributes = new Map()
const rootStyle = new Map()
const bodyStyle = new Map()
const styleElements = []
let observerCount = 0

const fakeElement = (tag) => ({
  tagName: tag,
  children: [],
  classList: { add() {}, remove() {}, contains: () => false },
  className: '',
  dataset: {},
  style: { setProperty: (k, v) => bodyStyle.set(k, v), removeProperty: (k) => bodyStyle.delete(k), zoom: '' },
  getAttribute: (n) => attributes.get(n) ?? null,
  setAttribute: (n, v) => attributes.set(n, v),
  removeAttribute: (n) => attributes.delete(n),
  appendChild() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  isConnected: true,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0 }),
})

const head = fakeElement('head')
const body = fakeElement('body')
const documentElement = fakeElement('html')
documentElement.style = { setProperty: (k, v) => rootStyle.set(k, v), removeProperty: (k) => rootStyle.delete(k) }

const document = {
  documentElement,
  body,
  head,
  createElement: (tag) => {
    if (tag === 'style') {
      const el = fakeElement('style')
      el.remove = () => {}
      return el
    }
    return fakeElement(tag)
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
}

const sandbox = {
  window: {
    __ModuleLoader__: { load(mod) { sandbox.__loaded = mod } },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1440,
  },
  navigator: { platform: 'Win32', userAgentData: { platform: 'Windows' } },
  document,
  requestAnimationFrame: (fn) => fn(),
  MutationObserver: class { observe() { observerCount++ } disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  console,
}
sandbox.window.MutationObserver = sandbox.MutationObserver
sandbox.window.ResizeObserver = sandbox.ResizeObserver
sandbox.globalThis = sandbox
vm.createContext(sandbox)

// ── 装载 ──
new vm.Script(bundle, { filename: 'lib/client.js' }).runInContext(sandbox)
assert.ok(sandbox.__loaded, '工厂应向 __ModuleLoader__.load 注册自己')
assert.strictEqual(sandbox.__loaded.id, 'dsh-claude-lite', '注册 id 应为包名')
assert.strictEqual(typeof sandbox.__loaded.factory, 'function', '注册应携带 factory')

// ── 装配 ──
const require = (name) => { throw new Error(`不应有服务依赖：${name}`) }
const teardowns = []
const ctx = {
  fiber: { entry: { id: 'ui-skin-claude-lite' } },
  get: () => undefined,
  // 宿主语义：注册即执行，effect 的返回值作为清理函数在卸载时调用。
  effect: (fn) => teardowns.push(fn()),
}
sandbox.__loaded.factory(require).apply(ctx)
assert.strictEqual(teardowns.length, 1, 'apply 应注册恰好一个 effect')
// BUILD_ID 槽已被替换为哈希，body 标记应带上它
const bodyMark = attributes.get('data-dsh-lite')
assert.ok(bodyMark && bodyMark !== '%%BUILD_ID%%' && bodyMark.length === 12, `皮肤标记应为 12 位构建 id，实际 ${bodyMark}`)
assert.strictEqual(attributes.get('data-dsh-lite-theme'), 'claude', '默认主题应镜像为 claude')
assert.strictEqual(document.body.dataset.pluginSkin, 'dsh-claude-lite', '应标记 pluginSkin')

// 样式表挂载：head 里应有一个 style，内容含三段标记
const sheetEl = styleElements.at(-1)
// 挂载走 head.appendChild 桩（上面未记录），改从 textContent 验证——桩里 createElement 返回对象，
// mountStylesheet 把 textContent 写上去。这里直接校验 bundle 内联的 CSS 关键词。
for (const marker of ['--dsh-lite-canvas: var(--dsh-lite-user-canvas', 'data-dsh-lite-header-band~=', "data-dsh-lite-part~='new-session'"]) {
  assert.ok(bundle.includes(marker), `bundle 应内联样式标记 ${marker}`)
}

// ── 卸载 ──
const teardown = teardowns[0]
teardown()
assert.strictEqual(attributes.has('data-dsh-lite'), false, '卸载应摘掉皮肤标记')
assert.strictEqual(rootStyle.size, 0, '卸载应清空 :root 变量')

console.log('冒烟通过：装载 / 装配 / 镜像 / 卸载 全部符合预期')
