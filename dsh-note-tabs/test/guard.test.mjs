// 静态守卫：锁住几条被反复踩过的红线，防止回归。
// 运行：node --test "dsh-note-tabs/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8');

test('不调用裸 close()：它会解析成 window.close() 并关掉桌面窗口', () => {
  // 只允许 closeHover( / close 作为属性或字符串出现
  const bare = [...source.matchAll(/(?<![.\w])close\s*\(/g)]
    .filter((match) => source.slice(Math.max(0, match.index - 5), match.index) !== 'close');
  assert.deepEqual(bare.map((match) => source.slice(match.index - 20, match.index + 8)), []);
  assert.match(source, /sent[\s\S]{0,0}/, 'noop');
});

test('Markdown 渲染复用 DSH 基线模块，不自写解析器', () => {
  assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
  assert.match(source, /\bMarkdownText\b/);
  assert.equal(source.includes('function renderMarkdown'), false, '自写渲染器已删除');
  assert.equal(source.includes('function renderInline'), false, '自写行内渲染已删除');
});

test('字体只走 DSH token，不写死字体栈', () => {
  // FONT_CODE 已被清掉（定义后零引用）：等宽字体直接写 var(--ds-font-family-code) 的地方才需要它
  assert.match(source, /var FONT_TEXT = "var\(--dsw-font-family\)"/);
  assert.equal(source.includes('var FONT_CODE'), false, 'FONT_CODE 是死变量，不该留');
  for (const stack of ['Iowan Old Style', 'Segoe UI', 'Microsoft YaHei', 'SFMono-Regular', 'Songti SC', 'monospace']) {
    assert.equal(source.includes(stack), false, '残留写死字体栈：' + stack);
  }
  // 字号跟随用户在设置里的正文字号
  assert.match(source, /--dsh-content-font-size/);
});

test('MarkdownText 是 memo 对象也要认，否则永远降级成纯文本', () => {
  // React.memo 返回对象而非函数：用 typeof === "function" 判定会静默失效。
  assert.match(source, /typeof primitives\.MarkdownText === "object"/);
});

test('发送后不切换面板的例外只有详情页：浮层留在原处', () => {
  // 详情页「传送到输入框」= 回会话；浮层里的发送只收浮层，不跳转。
  assert.match(source, /var sent = sendToInput\(note\.text\);[\s\S]{0,80}backToConversation\(\)/, '详情页发送回会话');
  assert.match(source, /sendToInput\(row\.raw\); closeHover\(\);/, '浮层发送只收浮层');
});

test('新建便签走 host 的 add 操作并复用同一套组件', () => {
  assert.match(source, /rpc\("add"/);
  assert.match(source, /function DraftCard/);
  assert.match(source, /\bt\("newNote"\)/);
});
test('每种 JSX 类名都有对应样式，浮层有可见性开关', () => {
  // 上一轮重写样式块时丢了 .dnt-hover[data-open] 和 .dnt-hc-scroll：
  // 前者让 hover 完全看不见（基础态 opacity:0），后者列表滚不动。
  assert.match(source, /\.dnt-hover\[data-open='true'\]\{opacity:1/, '浮层打开态必须可见');
  const used = new Set();
  for (const m of source.matchAll(/className: "([^"]+)"/g)) {
    for (const name of m[1].split(/\s+/)) if (name.startsWith('dnt-')) used.add(name);
  }
  const declared = new Set([...source.matchAll(/\.(dnt-[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], '这些类名用到了但没有样式：' + missing.join(','));
});
test('共用类不能只挂在某一个入口的父选择器下', () => {
  // 真实事故：角标写成「左栏根 .dnt-cnt」，左栏有样式、标题栏那个 span
  // 一条规则也匹配不上，渲染成贴着图标的裸文字——看起来就像入口丢了样式。
  // 后代选择器本身合法（toast 的关闭键就靠它），但不许把父级写成入口根。
  const ENTRY_ROOTS = ['dnt-rail', 'dnt-hdr'];
  const offenders = [];
  for (const block of source.matchAll(/(^|})\s*([^{}@]+)\{[^}]*\}/g)) {
    const selector = block[2];
    for (const root of ENTRY_ROOTS) {
      const scoped = new RegExp('\\.' + root + '\\s+\\.(dnt-[a-z0-9-]+)').exec(selector);
      if (scoped) offenders.push(root + ' > ' + scoped[1]);
    }
  }
  assert.deepEqual(offenders, [], '这些类被绑死在一个入口的父选择器下：' + offenders.join(','));
  assert.match(source, /^ {6}"\.dnt-cnt\{/m, '.dnt-cnt 必须是顶层选择器，两个入口共用');
});
test('浮层打开后指针离开图标也要排关闭：否则浮层永久悬空', () => {
  // 指针横穿离开时不会触发浮层自身的 pointerleave，只能由图标补一次延迟关闭。
  assert.match(source, /if \(state\.hover\.open\) scheduleHoverClose\(\)/, '图标离开要补关闭');
});

test('并发响应按序号取大者，旧 store 不得覆盖新数据', () => {
  assert.match(source, /var storeSeq = 0/, '有单调序号');
  assert.match(source, /if \(seq < storeSeq\) return/, '旧序号直接丢弃');
  // 每个 rpc 的成功分支都必须带序号（漏一个就回到覆盖竞态）
  const bare = [...source.matchAll(/applyStore\(result\.store\)/g)];
  assert.deepEqual(bare.map((m) => source.slice(m.index - 100, m.index + 30)), [], '所有 applyStore 都要带 seq');
});

test('workspaces 选择器守住 undefined：hook 缺失时不能崩掉整条 action 行', () => {
  assert.match(source, /var items = value && Array\.isArray\(value\.items\) \? value\.items : \[\]/);
  assert.equal(/for \(var index = 0; index < value\.items\.length/.test(source), false, '不许直接解引用');
});
test('快照键清单覆盖 state 的每个字段（加字段不会静默漏抄）', () => {
  const stateBlock = source.slice(source.indexOf('var state = {'), source.indexOf('var listeners = [];'));
  const stateKeys = [...stateBlock.matchAll(/^      ([a-zA-Z]+):/gm)].map((m) => m[1]);
  const snapshotBlock = source.slice(source.indexOf('var SNAPSHOT_KEYS = ['), source.indexOf('function snapshot()'));
  const snapshotKeys = [...snapshotBlock.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  // 纯内部计数器不需要进快照：订阅者拿不到也没用
  const INTERNAL = new Set(['toastSeq']);
  const missing = stateKeys.filter((key) => !INTERNAL.has(key) && !snapshotKeys.includes(key));
  assert.deepEqual(missing, [], '这些 state 字段没有进快照：' + missing.join(','));
});

test('设置预览吃 defaultView：改默认视图也要有反应（Q6d）', () => {
  assert.match(source, /"data-view": settings\.defaultView/);
  assert.match(source, /settings\.defaultView === "grouped"/);
});

test('卡片网格是 300px 起（Q6b），不是 268px', () => {
  assert.match(source, /minmax\(300px,1fr\)/);
  assert.equal(source.includes('minmax(268px'), false, '网格宽度偏离设计稿');
});

test('气泡点外部关闭，详情页不再有 tab', () => {
  assert.match(source, /document\.addEventListener\("pointerdown", onDown, true\)/, '捕获阶段监听点外部');
  assert.match(source, /hoverAnchorEl/, '触发按钮算内部，点它本身不会被外部关闭抢先');
  assert.equal(source.includes('className: "dnt-tabs"'), false, '详情页 tab 已删除');
  assert.equal(source.includes('t("tabNotes")'), false, '旧 tab 文案已删除');
});

test('标题栏入口走声明式 slot，关闭位置时真的注销注册', () => {
  assert.match(source, /slots\.inject\("conversation\.session\.header\.utilities"/);
  assert.match(source, /order: 100/, '排在 utilities 最右端，紧邻右侧栏展开按钮');
  assert.match(source, /unmountEntry\("sidebar"\)/, '左栏行不能只靠组件返回 null 隐藏');
  assert.match(source, /slots\.inject\("settings\.section"/, '配置回到设置页');
});

test('错误按 host 给的 code 分派，不靠中文字符串判断', () => {
  assert.equal(source.includes('message.indexOf("相同")'), false, '不许用文案耦合判断错误类型');
  assert.match(source, /failure\.code = parsed && typeof parsed\.code === "string"/);
  assert.match(source, /function describeError\(error\)/);
});
