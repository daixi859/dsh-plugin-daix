// lib/prompt.js 纯函数测试。运行：node --test dsh-prompt-suggest/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSISTANT_TAIL_CHARS,
  DRAFT_MAX_CHARS,
  POLISH_GROWTH_FACTOR,
  POLISH_MAX_CHARS,
  POLISH_MIN_CHARS,
  SUGGEST_MAX_CHARS,
  USER_TAIL_CHARS,
  buildPrompt,
  blocksText,
  draftTooLong,
  extractLastTurnText,
  normalizeForCompare,
  polishCap,
  sanitizeOutput,
  stripWrappingQuotes,
  tailText,
} from '../lib/prompt.js';

// ── tailText / draftTooLong ──────────────────────────────────────────────────

test('tailText 保留末尾并先 trim', () => {
  assert.equal(tailText('  abc  ', 10), 'abc');
  const long = 'x'.repeat(50) + 'y'.repeat(30);
  assert.equal(tailText(long, 10), 'y'.repeat(10));
});

test('tailText 超限保留末尾', () => {
  assert.equal(tailText('abcdef', 3), 'def');
  assert.equal(tailText('', 5), '');
});

test('draftTooLong 超限返回消息，未超返回 null', () => {
  assert.equal(draftTooLong('x'.repeat(DRAFT_MAX_CHARS)), null);
  const message = draftTooLong('x'.repeat(DRAFT_MAX_CHARS + 1));
  assert.match(message, new RegExp(String(DRAFT_MAX_CHARS)));
  assert.match(message, /分段润色/);
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

// ── buildPrompt：suggest ─────────────────────────────────────────────────────

test('suggest 提示词含推进判据、写法约束与对话素材', () => {
  const prompt = buildPrompt('suggest', { userText: '帮我看看', assistantText: '看过了' });
  // 选择判据：没有它模型只能猜粒度
  assert.match(prompt, /先判断该推进什么/);
  assert.match(prompt, /待确认项/);
  // 形态约束
  assert.match(prompt, /不超过 60 个字/);
  assert.match(prompt, /动词开头/);
  assert.match(prompt, /不要复述上一轮/);
  // 上下文进了提示词，且被围成数据块
  assert.match(prompt, /帮我看看/);
  assert.match(prompt, /看过了/);
  assert.match(prompt, /"""/);
  // 示例是成对的正反例
  assert.match(prompt, /不合格：/);
  assert.match(prompt, /合格：/);
  assert.doesNotMatch(prompt, /润色/);
});

test('suggest 不再写死"使用中文"，改为跟随输入语言', () => {
  const prompt = buildPrompt('suggest', { userText: 'u', assistantText: 'a' });
  assert.match(prompt, /语言跟随输入/);
  assert.doesNotMatch(prompt, /使用中文。/);
});

test('suggest 上下文按上限尾截', () => {
  const longUser = 'u'.repeat(USER_TAIL_CHARS + 100);
  const longAssistant = 'a'.repeat(ASSISTANT_TAIL_CHARS + 100);
  const prompt = buildPrompt('suggest', { userText: longUser, assistantText: longAssistant });
  assert.ok(!prompt.includes('u'.repeat(USER_TAIL_CHARS + 1)));
  assert.ok(!prompt.includes('a'.repeat(ASSISTANT_TAIL_CHARS + 1)));
  assert.ok(prompt.includes('a'.repeat(50)));
  // 保留的是尾部：代理的结论总在最后
  assert.ok(prompt.includes('a'.repeat(ASSISTANT_TAIL_CHARS)));
});

test('上下文为空时写成（无）而不是留空', () => {
  const prompt = buildPrompt('suggest', { userText: '', assistantText: '有回复' });
  assert.match(prompt, /（无）/);
});

// ── buildPrompt：polish ──────────────────────────────────────────────────────

test('polish 接入上下文，并要求只用于判断意图', () => {
  const prompt = buildPrompt('polish', {
    draft: '帮我修一下这个bug',
    userText: '登录一直超时',
    assistantText: '定位到 login.ts 的 token 刷新竞态',
  });
  assert.match(prompt, /帮我修一下这个bug/);
  assert.match(prompt, /登录一直超时/);
  assert.match(prompt, /token 刷新竞态/);
  assert.match(prompt, /只用来判断意图，不要复述/);
});

test('polish 按信息量分三档力度，而不是并列两条互相打架的约束', () => {
  const prompt = buildPrompt('polish', { draft: '优化一下', userText: '', assistantText: '' });
  assert.match(prompt, /先判断力度/);
  assert.match(prompt, /只润色/);
  assert.match(prompt, /补全/);
  assert.match(prompt, /是一个问句 → 不要回答它/);
  // 旧措辞：把"补全意图"和"不要添加新需求"并列，模型无从取舍
  assert.doesNotMatch(prompt, /不要添加草稿中没有的新需求/);
  assert.doesNotMatch(prompt, /保留原意/);
});

test('polish 给"原样输出"留出口，避免为改而改', () => {
  const prompt = buildPrompt('polish', { draft: '把 timeout 从 30s 改成 60s', userText: '', assistantText: '' });
  assert.match(prompt, /原样输出/);
});

test('polish 草稿整段送入，不静默截断', () => {
  // 带首尾标记，确认尾部（旧版 headText 会吃掉的部分）确实在提示词里。
  const body = 'h'.repeat(DRAFT_MAX_CHARS - 20);
  const draft = '开头标记' + body + '结尾标记';
  const prompt = buildPrompt('polish', { draft, userText: '', assistantText: '' });
  assert.ok(prompt.includes('开头标记'));
  assert.ok(prompt.includes('结尾标记'));
});

test('polish 把 polishCap 的数字写进提示词，与清洗层同源', () => {
  const draft = 'x'.repeat(1000);
  const prompt = buildPrompt('polish', { draft, userText: '', assistantText: '' });
  assert.match(prompt, new RegExp('总长控制在 ' + polishCap(draft) + ' 字以内'));
  assert.match(prompt, new RegExp('草稿篇幅的 ' + POLISH_GROWTH_FACTOR + ' 倍'));
  const short = buildPrompt('polish', { draft: '短', userText: '', assistantText: '' });
  assert.match(short, new RegExp(String(POLISH_MIN_CHARS)));
});

test('polish 长度条款不把「两倍」与「下限」说成同一个量', () => {
  // 10 字草稿的 2 倍是 20，上限却是 600——旧措辞「不超过它的两倍（600 字以内）」自相矛盾。
  const prompt = buildPrompt('polish', { draft: 'x'.repeat(10), userText: '', assistantText: '' });
  assert.doesNotMatch(prompt, /不超过它的两倍（/u);
  assert.match(prompt, /取较大者/u);
});

test('两个模式共用同一份输出契约', () => {
  for (const mode of ['suggest', 'polish']) {
    const prompt = buildPrompt(mode, { draft: 'd', userText: 'u', assistantText: 'a' });
    assert.match(prompt, /不要写成问句/);
    assert.match(prompt, /不要放进代码围栏/);
    assert.match(prompt, /事实逐字保留/);
    assert.match(prompt, /语言跟随输入/);
  }
});

test('"不要编造/占位符"只加在 polish：suggest 是凭空生成，没有可保留的事实', () => {
  const polish = buildPrompt('polish', { draft: 'd', userText: '', assistantText: '' });
  assert.match(polish, /不要写成 <占位符>/);
  const suggest = buildPrompt('suggest', { draft: '', userText: 'u', assistantText: 'a' });
  assert.doesNotMatch(suggest, /占位符/);
});

// ── polishCap ────────────────────────────────────────────────────────────────

test('polishCap 按原文两倍放宽，并夹在上下限之间', () => {
  assert.equal(polishCap(''), POLISH_MIN_CHARS);
  assert.equal(polishCap('短'), POLISH_MIN_CHARS);
  assert.equal(polishCap('x'.repeat(1000)), 2000);
  // 8000 字满额草稿正好顶到上限
  assert.equal(polishCap('x'.repeat(DRAFT_MAX_CHARS)), POLISH_MAX_CHARS);
  assert.equal(polishCap('x'.repeat(100000)), POLISH_MAX_CHARS);
});

// ── sanitizeOutput ────────────────────────────────────────────────────────────

test('suggest 剥包裹引号与前言', () => {
  assert.equal(sanitizeOutput('"帮我写个测试"', 'suggest'), '帮我写个测试');
  assert.equal(sanitizeOutput('“先跑一下构建”', 'suggest'), '先跑一下构建');
});

test('suggest 取第一个非空行', () => {
  assert.equal(sanitizeOutput('\n\n  修复登录超时  \n\n第二行', 'suggest'), '修复登录超时');
});

test('suggest 剥整段代码围栏', () => {
  assert.equal(sanitizeOutput('```\n先跑一遍单元测试\n```', 'suggest'), '先跑一遍单元测试');
  assert.equal(sanitizeOutput('```text\n先跑一遍单元测试\n```', 'suggest'), '先跑一遍单元测试');
});

test('suggest 超 SUGGEST_MAX_CHARS 判失败', () => {
  assert.equal(sanitizeOutput('x'.repeat(SUGGEST_MAX_CHARS + 1), 'suggest'), null);
  assert.equal(sanitizeOutput('x'.repeat(SUGGEST_MAX_CHARS), 'suggest'), 'x'.repeat(SUGGEST_MAX_CHARS));
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

test('polish 保留多行并剥围栏与引号', () => {
  const multi = '第一行\n第二行\n第三行';
  assert.equal(sanitizeOutput('“' + multi + '”', 'polish'), multi);
  assert.equal(sanitizeOutput('```\n' + multi + '\n```', 'polish'), multi);
});

test('polish 长度上限跟随原文，而不是固定值', () => {
  const shortDraft = 'x'.repeat(10);
  assert.equal(sanitizeOutput('y'.repeat(2000), 'polish', shortDraft).length, POLISH_MIN_CHARS);
  const longDraft = 'x'.repeat(1000);
  assert.equal(sanitizeOutput('y'.repeat(5000), 'polish', longDraft).length, 2000);
  // 满额草稿：上限 16000，不会被截到 4000
  const full = sanitizeOutput('y'.repeat(20000), 'polish', 'x'.repeat(DRAFT_MAX_CHARS));
  assert.equal(full.length, POLISH_MAX_CHARS);
  // 短结果不截断
  assert.equal(sanitizeOutput('y'.repeat(100), 'polish', longDraft), 'y'.repeat(100));
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

test('polish 闭环：模型原样返回草稿时结果等于原文', () => {
  const draft = '把 timeout 从 30s 改成 60s';
  assert.equal(sanitizeOutput(draft, 'polish', draft), draft);
});
