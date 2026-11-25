// lib/prompt.js 纯函数测试。运行：node --test dsh-prompt-suggest/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSISTANT_TAIL_CHARS,
  DEFAULT_TEMPLATES,
  DRAFT_MAX_CHARS,
  POLISH_GROWTH_FACTOR,
  POLISH_MAX_CHARS,
  POLISH_MIN_CHARS,
  SAMPLES,
  TEMPLATE_MAX_CHARS,
  USER_TAIL_CHARS,
  blocksText,
  buildPrompt,
  draftTooLong,
  extractLastTurnText,
  placeholdersIn,
  polishCap,
  renderTemplate,
  tailText,
  validateTemplate,
} from '../lib/prompt.js';

// ── tailText / draftTooLong ──────────────────────────────────────────────────

test('tailText 保留末尾并先 trim', () => {
  assert.equal(tailText('  abc  ', 10), 'abc');
  assert.equal(tailText('abcdef', 3), 'def');
  assert.equal(tailText('', 5), '');
});

test('draftTooLong 默认上限超限返回消息，未超返回 null', () => {
  assert.equal(draftTooLong('x'.repeat(DRAFT_MAX_CHARS)), null);
  const message = draftTooLong('x'.repeat(DRAFT_MAX_CHARS + 1));
  assert.match(message, new RegExp(String(DRAFT_MAX_CHARS)));
  assert.match(message, /分段润色/);
});

test('draftTooLong 使用传入的上限（设置页可调）', () => {
  assert.equal(draftTooLong('x'.repeat(500), 500), null);
  assert.match(draftTooLong('x'.repeat(501), 500), /超过 500 字符/);
});

// ── blocksText / extractLastTurnText ─────────────────────────────────────────

test('blocksText 只拼文本块', () => {
  assert.equal(blocksText([
    { type: 'text', text: 'a' },
    { type: 'tool-call', id: '1', name: 'x', arguments: '{}' },
    { type: 'text', text: 'b' },
  ]), 'a\nb');
  assert.equal(blocksText(undefined), '');
  assert.equal(blocksText('not-array'), '');
});

const events = [
  { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一条' }] } },
  { type: 'assistant/message', seq: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: '回复一' }] } } },
  { type: 'tool/result', seq: 3, data: {} },
  { type: 'user/message', seq: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二条' }] } },
  { type: 'assistant/message', seq: 5, data: { message: { role: 'assistant', content: [{ type: 'text', text: '回复二' }, { type: 'text', text: '续' }] } } },
];

test('extractLastTurnText 取最近一轮(倒序)', () => {
  const got = extractLastTurnText(events);
  assert.equal(got.userText, '第二条');
  assert.equal(got.assistantText, '回复二\n续');
});

test('extractLastTurnText 忽略非 user 来源的 user/message', () => {
  const injected = [
    { type: 'user/message', seq: 1, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '系统注入' }] } },
    { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真人' }] } },
  ];
  assert.equal(extractLastTurnText(injected).userText, '真人');
});

test('extractLastTurnText 无 assistant 时返回空 assistantText', () => {
  const got = extractLastTurnText(events.slice(0, 1));
  assert.equal(got.userText, '第一条');
  assert.equal(got.assistantText, '');
});

test('extractLastTurnText 空事件流', () => {
  assert.deepEqual(extractLastTurnText([]), { userText: '', assistantText: '' });
});

// ── placeholdersIn / renderTemplate ──────────────────────────────────────────

test('placeholdersIn 按出现顺序列出占位符', () => {
  assert.deepEqual(placeholdersIn('a {{x}} b {{y}} c {{x}}'), ['x', 'y', 'x']);
  assert.deepEqual(placeholdersIn('没有占位符'), []);
});

test('renderTemplate 单次替换，素材里的 {{x}} 不会被再次展开', () => {
  assert.equal(renderTemplate('A={{a}} B={{b}}', { a: '{{b}}', b: 'B' }), 'A={{b}} B=B');
});

test('renderTemplate 未提供的名字原样保留', () => {
  assert.equal(renderTemplate('{{a}}{{c}}', { a: '1' }), '1{{c}}');
});

// ── validateTemplate ─────────────────────────────────────────────────────────

test('内置默认模板本身通过校验', () => {
  assert.equal(validateTemplate('suggest', DEFAULT_TEMPLATES.suggest), null);
  assert.equal(validateTemplate('polish', DEFAULT_TEMPLATES.polish), null);
});

test('validateTemplate 拒绝空白模板', () => {
  assert.match(validateTemplate('suggest', '   '), /不能为空/);
});

test('validateTemplate 列出缺失的必需占位符', () => {
  const message = validateTemplate('suggest', '只有 {{userText}}');
  assert.match(message, /缺少必需的占位符/);
  assert.match(message, /\{\{assistantText\}\}/);
  assert.doesNotMatch(message, /\{\{userText\}\}/);
});

test('validateTemplate polish 需要 draft 与 polishCap', () => {
  const message = validateTemplate('polish', '{{userText}}{{assistantText}}');
  assert.match(message, /\{\{draft\}\}/);
  assert.match(message, /\{\{polishCap\}\}/);
});

test('validateTemplate 拒绝当前模式不允许的占位符', () => {
  const message = validateTemplate('suggest', '{{userText}}{{assistantText}}{{draft}}');
  assert.match(message, /未知占位符/);
  assert.match(message, /\{\{draft\}\}/);
});

test('validateTemplate 拒绝写坏的占位符', () => {
  const message = validateTemplate('suggest', '{{userText}} {{ assistantText }}');
  assert.match(message, /格式不对/);
});

test('validateTemplate 超过模板上限时拒绝', () => {
  const base = DEFAULT_TEMPLATES.suggest;
  assert.equal(validateTemplate('suggest', base, base.length), null);
  assert.match(validateTemplate('suggest', base, base.length - 1), /超过/);
  assert.equal(TEMPLATE_MAX_CHARS, 8000);
});

// ── buildPrompt：默认模板 ────────────────────────────────────────────────────

test('suggest 默认模板含推进判据、写法约束与对话素材', () => {
  const prompt = buildPrompt('suggest', undefined, { userText: '帮我看看', assistantText: '看过了' });
  assert.match(prompt, /先判断该推进什么/);
  assert.match(prompt, /待确认项/);
  assert.match(prompt, /不超过 60 个字/);
  assert.match(prompt, /动词开头/);
  assert.match(prompt, /不要复述上一轮/);
  assert.match(prompt, /帮我看看/);
  assert.match(prompt, /看过了/);
  assert.match(prompt, /"""/);
  assert.match(prompt, /不合格：/);
  assert.match(prompt, /合格：/);
  assert.doesNotMatch(prompt, /润色/);
  assert.doesNotMatch(prompt, /\{\{\w+\}\}/);
});

test('默认模板的输出规则只写"语言跟随输入"，不写死中文', () => {
  const prompt = buildPrompt('suggest', undefined, { userText: 'u', assistantText: 'a' });
  assert.match(prompt, /语言跟随输入/);
  assert.doesNotMatch(prompt, /使用中文。/);
});

test('suggest 上下文按上限尾截', () => {
  const longUser = 'u'.repeat(USER_TAIL_CHARS + 100);
  const longAssistant = 'a'.repeat(ASSISTANT_TAIL_CHARS + 100);
  const prompt = buildPrompt('suggest', undefined, { userText: longUser, assistantText: longAssistant });
  assert.ok(!prompt.includes('u'.repeat(USER_TAIL_CHARS + 1)));
  assert.ok(!prompt.includes('a'.repeat(ASSISTANT_TAIL_CHARS + 1)));
  assert.ok(prompt.includes('a'.repeat(ASSISTANT_TAIL_CHARS)));
});

test('上下文为空时写成（无）而不是留空', () => {
  const prompt = buildPrompt('suggest', undefined, { userText: '', assistantText: '有回复' });
  assert.match(prompt, /（无）/);
});

test('polish 默认模板接入上下文与草稿，并要求只用于判断意图', () => {
  const prompt = buildPrompt('polish', undefined, {
    draft: '帮我修一下这个bug',
    userText: '登录一直超时',
    assistantText: '定位到 login.ts 的 token 刷新竞态',
  });
  assert.match(prompt, /帮我修一下这个bug/);
  assert.match(prompt, /登录一直超时/);
  assert.match(prompt, /token 刷新竞态/);
  assert.match(prompt, /只用来判断意图，不要复述/);
});

test('polish 默认模板给"原样输出"留出口', () => {
  const prompt = buildPrompt('polish', undefined, { draft: '把 timeout 从 30s 改成 60s' });
  assert.match(prompt, /原样输出/);
});

test('polish 草稿整段送入，不静默截断', () => {
  const body = 'h'.repeat(DRAFT_MAX_CHARS - 20);
  const draft = '开头标记' + body + '结尾标记';
  const prompt = buildPrompt('polish', undefined, { draft });
  assert.ok(prompt.includes('开头标记'));
  assert.ok(prompt.includes('结尾标记'));
});

test('polish 把 polishCap 的数字写进提示词，并随草稿变化', () => {
  const draft = 'x'.repeat(1000);
  const prompt = buildPrompt('polish', undefined, { draft });
  assert.match(prompt, new RegExp('总长控制在 ' + polishCap(draft) + ' 字以内'));
  assert.equal(polishCap(draft), 1000 * POLISH_GROWTH_FACTOR);
  const short = buildPrompt('polish', undefined, { draft: '短' });
  assert.match(short, new RegExp('总长控制在 ' + POLISH_MIN_CHARS + ' 字以内'));
});

test('polishCap 按原文两倍放宽，并夹在上下限之间', () => {
  assert.equal(polishCap(''), POLISH_MIN_CHARS);
  assert.equal(polishCap('x'.repeat(1000)), 2000);
  assert.equal(polishCap('x'.repeat(100000)), POLISH_MAX_CHARS);
});

// ── 自定义模板 ───────────────────────────────────────────────────────────────

test('传入的模板替换默认模板，素材仍被注入', () => {
  const template = '自定义指令：{{userText}} / {{assistantText}}';
  assert.equal(buildPrompt('suggest', template, { userText: 'U', assistantText: 'A' }), '自定义指令：U / A');
});

test('空白模板回落到默认模板', () => {
  const fromBlank = buildPrompt('suggest', '  \n ', { userText: 'u', assistantText: 'a' });
  assert.equal(fromBlank, buildPrompt('suggest', undefined, { userText: 'u', assistantText: 'a' }));
});

test('polish 自定义模板中 {{polishCap}} 替换为数字', () => {
  const prompt = buildPrompt('polish', '{{draft}}|{{userText}}|{{assistantText}}|上限{{polishCap}}', {
    draft: 'x'.repeat(1000), userText: '', assistantText: '',
  });
  assert.equal(prompt, 'x'.repeat(1000) + '|（无）|（无）|上限2000');
});

// ── 样例与默认模板的一致性 ───────────────────────────────────────────────────

test('样例素材可以驱动两个默认模板且无残留占位符', () => {
  const s = buildPrompt('suggest', undefined, { userText: SAMPLES.userText, assistantText: SAMPLES.assistantText });
  const p = buildPrompt('polish', undefined, { draft: SAMPLES.draft, userText: SAMPLES.userText, assistantText: SAMPLES.assistantText });
  assert.doesNotMatch(s, /\{\{\w+\}\}/);
  assert.doesNotMatch(p, /\{\{\w+\}\}/);
});

test('两个模式共用同一份输出规则', () => {
  for (const mode of ['suggest', 'polish']) {
    const prompt = buildPrompt(mode, undefined, { draft: 'd', userText: 'u', assistantText: 'a' });
    assert.match(prompt, /不要写成问句/);
    assert.match(prompt, /不要放进代码围栏/);
    assert.match(prompt, /事实逐字保留/);
    assert.match(prompt, /语言跟随输入/);
  }
});
