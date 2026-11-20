// lib/prompt.js 纯函数测试。运行：node --test dsh-prompt-suggest/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  USER_TAIL_CHARS,
  ASSISTANT_TAIL_CHARS,
  buildPrompt,
  blocksText,
  extractLastTurnText,
  normalizeForCompare,
  sanitizeOutput,
  stripWrappingQuotes,
  tailText,
} from '../lib/prompt.js';

// ── tailText ──────────────────────────────────────────────────────────────────

test('tailText 保留末尾并先 trim', () => {
  assert.equal(tailText('  abc  ', 10), 'abc');
  const long = 'x'.repeat(50) + 'y'.repeat(30);
  assert.equal(tailText(long, 10), 'y'.repeat(10));
});

test('tailText 超限保留末尾(Pendant 同款尾截)', () => {
  assert.equal(tailText('abcdef', 3), 'def');
  assert.equal(tailText('', 5), '');
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

// ── buildPrompt ───────────────────────────────────────────────────────────────

test('suggest 模式含规则/两段上下文/中文指令', () => {
  const prompt = buildPrompt('suggest', { userText: '帮我看看', assistantText: '看过了' });
  assert.match(prompt, /下一条指令/);
  assert.match(prompt, /一行，最多 200 个字符/);
  assert.match(prompt, /只输出建议本身/);
  assert.match(prompt, /使用中文/);
  assert.match(prompt, /帮我看看/);
  assert.match(prompt, /看过了/);
  assert.doesNotMatch(prompt, /润色/);
});

test('polish 模式含草稿与润色规则', () => {
  const prompt = buildPrompt('polish', { draft: '帮我修一下这个bug', userText: '', assistantText: '' });
  assert.match(prompt, /润色/);
  assert.match(prompt, /保留原意/);
  assert.match(prompt, /帮我修一下这个bug/);
  assert.match(prompt, /开发者当前输入的草稿/);
});

test('suggest 模式上下文按上限尾截', () => {
  const longUser = 'u'.repeat(USER_TAIL_CHARS + 100);
  const longAssistant = 'a'.repeat(ASSISTANT_TAIL_CHARS + 100);
  const prompt = buildPrompt('suggest', { userText: longUser, assistantText: longAssistant });
  assert.ok(!prompt.includes('u'.repeat(USER_TAIL_CHARS + 1)));
  assert.ok(!prompt.includes('a'.repeat(ASSISTANT_TAIL_CHARS + 1)));
  assert.ok(prompt.includes('a'.repeat(50)));
});

// ── sanitizeOutput ────────────────────────────────────────────────────────────

test('suggest 剥包裹引号与前言', () => {
  assert.equal(sanitizeOutput('"帮我写个测试"', 'suggest'), '帮我写个测试');
  assert.equal(sanitizeOutput('“先跑一下构建”', 'suggest'), '先跑一下构建');
});

test('suggest 取第一个非空行', () => {
  assert.equal(sanitizeOutput('\n\n  修复登录超时  \n\n第二行', 'suggest'), '修复登录超时');
});

test('suggest 超 300 字符判失败', () => {
  assert.equal(sanitizeOutput('x'.repeat(301), 'suggest'), null);
  assert.equal(sanitizeOutput('x'.repeat(300), 'suggest'), 'x'.repeat(300));
});

test('suggest 与当前草稿相同(归一化比较)返回 null', () => {
  assert.equal(sanitizeOutput('Fix the bug', 'suggest', 'fix  the  BUG'), null);
  assert.equal(sanitizeOutput('Fix the bug', 'suggest', '其他'), 'Fix the bug');
});

test('suggest 空输出返回 null', () => {
  assert.equal(sanitizeOutput('', 'suggest'), null);
  assert.equal(sanitizeOutput('   \n  ', 'suggest'), null);
  assert.equal(sanitizeOutput('""', 'suggest'), null);
});

test('polish 保留多行并截断到上限', () => {
  const multi = '第一行\n第二行\n第三行';
  assert.equal(sanitizeOutput('“' + multi + '”', 'polish'), multi);
  assert.equal(sanitizeOutput('x'.repeat(4500), 'polish').length, 4000);
});

test('polish 剥复述任务的引导行', () => {
  const raw = '请帮我润色以下插件功能说明，使其表达更专业、更清晰，保持原意不变：\n\n该插件在聊天输入框中添加一个"AI建议"按钮。';
  assert.equal(sanitizeOutput(raw, 'polish'), '该插件在聊天输入框中添加一个"AI建议"按钮。');
});

test('polish 引导行超长或无冒号不剥', () => {
  const long = '这'.repeat(61) + '：\n正文';
  assert.equal(sanitizeOutput(long, 'polish'), long);
  const noColon = '帮我润色下面的内容\n正文内容';
  assert.equal(sanitizeOutput(noColon, 'polish'), noColon);
});

// ── stripWrappingQuotes / normalizeForCompare ────────────────────────────────

test('stripWrappingQuotes 覆盖各类括号', () => {
  assert.equal(stripWrappingQuotes('「建议」'), '建议');
  assert.equal(stripWrappingQuotes('『内容』'), '内容');
  assert.equal(stripWrappingQuotes("'单引号'"), '单引号');
  assert.equal(stripWrappingQuotes('不成对"引号'), '不成对"引号');
});

test('normalizeForCompare 忽略空白与大小写', () => {
  assert.equal(normalizeForCompare('Fix  The BUG'), normalizeForCompare('fixthebug'));
});

// ── buildPrompt 与 sanitize 的闭环 ────────────────────────────────────────────

test('suggest 闭环：prompt 里出现的草稿不会被误判相同', () => {
  const draft = '跑一下测试';
  const out = sanitizeOutput(draft, 'suggest', draft);
  assert.equal(out, null);
  const out2 = sanitizeOutput('先跑一遍单元测试再跑 lint', 'suggest', draft);
  assert.equal(out2, '先跑一遍单元测试再跑 lint');
});
