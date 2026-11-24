// client.js 冒烟测试：用最小假 window/React 走一遍注册与 apply，
// 确保工厂不抛错、五个插槽都注册、订阅与销毁干净。
// 运行：node --test "dsh-note-tabs/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8');

/** 最小 React 假件：只在注册期不用渲染，但组件构造需要 createElement/useState 可用。 */
function fakeReact() {
  const createElement = (type, props, ...children) => ({ type, props, children });
  return {
    createElement,
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value === undefined ? null : value }),
    useMemo: (factory) => factory(),
  };
}

function harness() {
  const registrations = [];
  const styles = [];
  const effects = [];
  const context = {
    React: fakeReact(),
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, store: { version: 1, notes: [], settings: { hoverCount: 10, hoverEnabled: true, defaultView: 'grouped' } } })) }),
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: (element) => { styles.push(element); } },
    },
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    window: undefined,
    JSON,
    Map,
    Set,
    String,
    Number,
    Object,
    Array,
    Math,
    URL,
  };
  context.window = { __ModuleLoader__: { load: ({ id, factory }) => { context.registered = { id, factory }; } } };
  context.globalThis = context;

  const sandbox = vm.createContext(context);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  const { id, factory } = context.registered;
  const plugin = factory(() => fakeReact());

  const registered = [];
  const slots = {
    inject(name, register) {
      const dispose = register();
      registrations.push({ name, dispose });
      return () => {
        if (typeof dispose === 'function') dispose();
        const at = registrations.findIndex((entry) => entry.dispose === dispose);
        if (at >= 0) registrations.splice(at, 1);
      };
    },
    register(options, component) {
      assert.equal(typeof options.name, 'string');
      assert.equal(typeof component, 'function');
      registered.push(options);
      return () => {
        const at = registered.indexOf(options);
        if (at >= 0) registered.splice(at, 1);
      };
    },
  };
  const ctx = {
    get: (name) => (name === 'slots' ? slots : name === 'layout' ? { selectPanel() {} } : name === 'locale' ? {
      getSnapshot: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    } : undefined),
    effect: (fn, label) => { effects.push({ label, dispose: fn() }); return () => {}; },
  };
  return { plugin, ctx, registrations, registered, effects, styles };
}

test('工厂注册出正确 id 且导出 apply/inject', () => {
  const h = harness();
  assert.equal(typeof h.plugin.apply, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.inject)), ['slots']);
  h.plugin.apply(h.ctx);
  assert.ok(h.registrations.length >= 1);
});

test('apply 注册六个插槽面（标题栏入口 + 独立设置页）', () => {
  const h = harness();
  h.plugin.apply(h.ctx);
  const names = h.registered.map((entry) => entry.name);
  assert.deepEqual([...new Set(names)].sort(), [
    'conversation.chat.assistant-actions',
    'conversation.session.header.utilities',
    'main',
    'settings.section',
    'shell.overlay',
    'sidebar.panellist',
  ].sort());
});

test('入口位置改变时动态注销/重注册，不留空按钮', () => {
  const h = harness();
  h.plugin.apply(h.ctx);
  const names = () => h.registered.map((entry) => entry.name);
  assert.ok(names().includes('sidebar.panellist'));
  assert.ok(names().includes('conversation.session.header.utilities'));

  // 一个都不选：两个注册都必须真的消失（组件返回 null 仍会留下左栏空按钮）
  h.plugin.__state.store.settings.entryPositions = [];
  h.plugin.__emit();
  assert.equal(names().includes('sidebar.panellist'), false);
  assert.equal(names().includes('conversation.session.header.utilities'), false);

  // 只开标题栏：左栏仍不注册
  h.plugin.__state.store.settings.entryPositions = ['header'];
  h.plugin.__emit();
  assert.equal(names().includes('sidebar.panellist'), false);
  assert.ok(names().includes('conversation.session.header.utilities'));
});

test('注入样式只加一次且带插件标记', () => {
  const h = harness();
  h.plugin.apply(h.ctx);
  assert.equal(h.styles.length, 1);
  assert.match(h.styles[0].textContent, /--dsw-alias-brand-primary/);
  assert.equal(h.styles[0].dataset.plugin, 'dsh-note-tabs');
});

test('apply 收集可销毁的 effect，销毁不抛错', () => {
  const h = harness();
  h.plugin.apply(h.ctx);
  assert.ok(h.effects.length >= 2);
  for (const entry of h.effects) {
    assert.equal(typeof entry.dispose, 'function');
    assert.doesNotThrow(() => entry.dispose());
  }
});