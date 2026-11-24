// 组件树渲染冒烟：用最小假 React 真的执行组件函数，确认五个面都能渲染出元素、
// 标题栏气泡可开合、设置页四偏好可渲染、返回按钮存在。运行：node --test "dsh-note-tabs/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8');

/** 极简 React：函数组件真的被调用，元素只是可检查的普通对象。 */
function fakeReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat().filter((child) => child !== null && child !== undefined && child !== false),
  });
  return {
    createElement,
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value === undefined ? null : value }),
    useMemo: (factory) => factory(),
  };
}

const EMPTY_STORE = {
  version: 1,
  notes: [],
  settings: { hoverCount: 10, hoverEnabled: true, defaultView: 'grouped' },
};

function harness(options = {}) {
  const React = fakeReact();
  const registered = [];
  const modules = {
    react: React,
    // 模拟宿主基线模块：MarkdownText 是 React.memo 的产物（对象，不是函数）
    '@deepseek-ai/dsh-client-ui-primitives': options.primitives,
  };
  const context = {
    React,
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true, store: EMPTY_STORE })),
    }),
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    console,
    setTimeout, clearTimeout,
    JSON, Map, Set, String, Number, Object, Array, Math,
  };
  context.window = { __ModuleLoader__: { load: (def) => { context.def = def; } } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'client.js' });

  const plugin = context.def.factory((spec) => {
    if (!(spec in modules)) throw new Error('module not found: ' + spec);
    return modules[spec];
  });
  const slots = {
    inject: (name, register) => { register(); return () => {}; },
    register: (options, component) => { registered.push({ options, component }); return () => {}; },
  };
  const ctx = {
    get: (name) => (name === 'slots' ? slots : name === 'locale' ? { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} } : name === 'layout' ? { selectPanel: () => {} } : undefined),
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
  };
  plugin.apply(ctx);
  return { React, registered, plugin, raf: () => {} };
}

/** React.memo 的返回值是对象：用一个可识别的假件确认展开态真的走了它。 */
const MEMO_MARKDOWN = { $$typeof: Symbol.for('react.memo'), type: 'FakeMarkdownText' };

/** 递归收集渲染树里的 host 元素类型与文本。 */
function walk(node, out = { types: [], text: [], labels: [], components: [] }) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (typeof node.type === 'object' && node.type !== null) {
    // memo/forwardRef 之类的组件对象：只记类型标签，不下钻
    out.components.push(node.type.type === 'FakeMarkdownText' ? 'FakeMarkdownText' : String(node.type.type));
    return out;
  }
  if (typeof node.type === 'function') { walk(node.type({ ...node.props, children: node.children }), out); return out; }
  if (typeof node.type === 'string') {
    out.types.push(node.type);
    if (node.props && node.props['aria-label']) out.labels.push(node.props['aria-label']);
  }
  for (const child of node.children || []) walk(child, out);
  return out;
}

function findComponent(registered, name) {
  return registered.find((entry) => entry.options.name === name);
}

function seedNotes() {
  // 直接改 client 状态仓里的 store，避免依赖网络
  const h = harness();
  const main = findComponent(h.registered, 'main');
  return { h, main };
}

test('详情页可渲染，且不再有便签/设置 tab', () => {
  const { h, main } = seedNotes();
  const tree = main.component({
    useWorkspaces: () => ({ items: [] }),
    useSessions: () => ({ ids: [], byId: {} }),
  });
  const shapes = walk(tree);
  assert.ok(shapes.types.includes('div'));
  assert.ok(shapes.labels.includes('返回会话'), '返回按钮有可访问名');
  assert.ok(shapes.text.some((text) => text.includes('新建便签')), '有新建便签入口');
  assert.equal(shapes.text.includes('设置'), false, '详情页没有设置 tab');
  assert.equal(shapes.text.includes('便签'), true, '标题仍是便签');
});

/** 按 className 找第一个 host 元素（用于模拟点击）。 */
function findByClass(node, className) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findByClass(child, className); if (hit) return hit; }
    return null;
  }
  if (typeof node === 'object' && node !== null && node.props
    && typeof node.props.className === 'string' && node.props.className.includes(className)) return node;
  if (typeof node === 'object' && node !== null && typeof node.type === 'function') {
    return findByClass(node.type({ ...node.props, children: node.children }), className);
  }
  for (const child of node.children || []) { const hit = findByClass(child, className); if (hit) return hit; }
  return null;
}

function seedOneNote(h) {
  h.plugin.__state.store = {
    version: 1,
    notes: [{ id: 'n1', text: '## 标题\n\n正文', workspaceId: null, sessionId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    settings: EMPTY_STORE.settings,
  };
  return { useWorkspaces: () => ({ items: [] }), useSessions: () => ({ ids: [], byId: {} }) };
}

test('卡片点开弹窗后真的走基线模块的 MarkdownText（memo 返回对象也要认）', () => {
  const h = harness({ primitives: { MarkdownText: MEMO_MARKDOWN } });
  const props = seedOneNote(h);
  const main = findComponent(h.registered, 'main');
  const body = findByClass(main.component(props), 'dnt-body');
  assert.ok(body !== null, '渲染出卡片摘要');
  body.props.onClick();  // 打开预览弹窗
  const modal = h.registered.filter((entry) => entry.options.id === 'note-tabs.modal')[0];
  const rendered = walk(modal.component({}));
  assert.ok(rendered.components.includes('FakeMarkdownText'),
    '弹窗预览交给 MarkdownText，而不是纯文本：' + JSON.stringify(rendered.components));
});

test('卡片摘要上不再内联展开，改成打开弹窗', () => {
  const h = harness({ primitives: { MarkdownText: MEMO_MARKDOWN } });
  const props = seedOneNote(h);
  const main = findComponent(h.registered, 'main');
  const body = findByClass(main.component(props), 'dnt-body');
  body.props.onClick();
  assert.equal(h.plugin.__state.modal.id, 'n1');
  assert.equal(h.plugin.__state.modal.mode, 'preview');
});

test('收藏按钮可渲染（正文取不到时禁用）', () => {
  const { h } = seedNotes();
  const entry = findComponent(h.registered, 'conversation.chat.assistant-actions');
  const tree = entry.component({
    messageId: 'm1',
    sessionId: 's1',
    useChat: (selector) => selector(undefined),
    useWorkspaces: () => ({ items: [] }),
    useInput: () => '',
    inputActions: undefined,
  });
  // 注册项返回组件元素；执行组件函数拿到 host button
  const rendered = tree.type(tree.props);
  assert.equal(rendered.type, 'button');
  assert.equal(rendered.props.disabled, true);
});

test('左栏图标可渲染且不产生嵌套 button', () => {
  const { h } = seedNotes();
  const entry = findComponent(h.registered, 'sidebar.panellist');
  const tree = entry.component({
    size: 20,
    active: false,
    useWorkspaces: () => ({ items: [] }),
    useSessions: () => ({ ids: [], byId: {} }),
  });
  const shapes = walk(tree);
  assert.ok(shapes.types.includes('span'), '渲染出 span 容器');
  assert.equal(shapes.types.includes('button'), false, '图标内部没有 button');
});

test('浮层头部右侧的「添加」展开输入区，并能提交到 host 的 add', () => {
  const h = harness({ primitives: { MarkdownText: MEMO_MARKDOWN } });
  const card = h.registered.filter((entry) => entry.options.name === 'shell.overlay')[0];
  const state = h.plugin.__state;
  state.hover = { open: true, top: 10, left: 10, workspaceTitle: 'ws', rows: [] };
  const opened = card.component({});
  const addBtn = findByClass(opened, 'dnt-hc-add');
  assert.ok(addBtn !== null, '浮层头部有添加入口');
  addBtn.props.onClick();
  const withCompose = card.component({});
  assert.ok(findByClass(withCompose, 'dnt-hc-compose') !== null, '点击后出现 textarea 输入区');
  const composed = findByClass(withCompose, 'dnt-hc-compose');
  const kids = [].concat(composed.children || [], composed.props.children || []).flat(4);
  assert.ok(kids.some((child) => child && child.type === 'textarea'), '输入区里是 textarea');
});

test('标题栏入口渲染按钮，点击展开 header 气泡，再点收起', () => {
  const h = harness({ primitives: { MarkdownText: MEMO_MARKDOWN } });
  const props = seedOneNote(h);
  const entry = findComponent(h.registered, 'conversation.session.header.utilities');
  assert.ok(entry, '标题栏 utilities 槽已注册');
  assert.equal(entry.options.order, 100, '排在 utilities 最右端');

  const button = findByClass(entry.component(props), 'dnt-hdr');
  assert.ok(button, '渲染出标题栏按钮');
  button.props.onClick();
  assert.equal(h.plugin.__state.hover.open, true);
  assert.equal(h.plugin.__state.hover.placement, 'header');

  const overlay = h.registered.filter((item) => item.options.id === 'note-tabs.hover')[0];
  const popover = walk(overlay.component({}));
  assert.ok(popover.types.includes('div'), '气泡渲染出来了');

  // 再点一次同一个按钮应收起（用新渲染的按钮，模拟状态更新后的视图）
  const button2 = findByClass(entry.component(props), 'dnt-hdr');
  button2.props.onClick();
  assert.equal(h.plugin.__state.hover.open, false);
});

test('设置页分区渲染四个偏好，含两个入口位置开关', () => {
  const h = harness();
  const section = findComponent(h.registered, 'settings.section');
  assert.ok(section, '设置页分区已注册');
  const shapes = walk(section.component({ useSessions: () => ({ ids: [], byId: {} }) }));
  assert.ok(shapes.labels.includes('左侧菜单'), '左栏入口开关有无障碍名');
  assert.ok(shapes.labels.includes('标题栏右侧'), '标题栏入口开关有无障碍名');
  assert.ok(shapes.labels.includes('悬浮框条数'), '原有偏好也搬过来了');
});

test('hover 浮层与 Toast 在关闭态渲染为空', () => {
  const { h } = seedNotes();
  const overlays = h.registered.filter((entry) => entry.options.name === 'shell.overlay');
  assert.equal(overlays.length, 3, '浮层 + 弹窗 + Toast');
  for (const entry of overlays) {
    // 注册项返回的是组件元素，需要再执行一次组件函数才拿到真正的渲染结果
    const rendered = walk(entry.component({}));
    assert.equal(rendered.types.length, 0, '关闭态不渲染任何 host 元素');
    assert.equal(rendered.text.length, 0, '关闭态不渲染任何文本');
  }
});