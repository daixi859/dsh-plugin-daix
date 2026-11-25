// lib/index.js 路由层测试：用一个假 ctx 把 webServer 路由接出来，走真实 handler。
// 纯函数测试抓不到「字段名对不上」「某条失败没落盘」这类问题，这一层就是补这个缺口。
// 运行：node --test dsh-prompt-suggest/test/routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../lib/index.js';
import { DEFAULT_TEMPLATES, DRAFT_MAX_CHARS, TEMPLATE_MAX_CHARS } from '../lib/prompt.js';

async function makeHome() {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-suggest-test-'));
  process.env.DSH_HOME = dir;
  return dir;
}

async function writeSettings(home, value) {
  const dir = join(home, 'storages', 'prompt-suggest');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify(value), 'utf8');
}

/**
 * 读诊断日志。recordFailure 是 void 调用（fire-and-forget，不拖慢响应），
 * 所以这里给一点轮询窗口，而不是假设它已经落盘。
 */
async function readLastError(home) {
  const file = join(home, 'storages', 'prompt-suggest', 'last-error.json');
  for (let i = 0; i < 50; i += 1) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
  }
  throw new Error('诊断日志始终没有落盘：' + file);
}

/**
 * 起一个假 ctx：把路由收集到 routes，llm/sessionQuery 按测试需要注入。
 * handler 用假的 req/res 驱动，res 只记录状态码与 JSON 体。
 */
function boot(options = {}) {
  const routes = new Map();
  const ctx = {
    get(name) {
      if (name === 'webServer') {
        return { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path); } };
      }
      if (name === 'llm') return options.llm;
      if (name === 'sessionQuery') return options.sessionQuery;
      if (name === 'agentDefaultModel') return options.agentDefaultModel;
      return undefined;
    },
    effect() {},
    on() {},
  };
  apply(ctx);
  return { routes, ctx };
}

/**
 * 调一条路由，返回 { status, body }。
 * 路由注册的是 `void handle(req, res)`：handler 立刻返回，真正的活在异步里继续跑，
 * 所以这里必须等 res.end 被调用，而不是 await handler。
 */
async function call(routes, path, { method = 'POST', body } = {}) {
  const handler = routes.get(path);
  if (handler === undefined) throw new Error('路由未注册：' + path);
  const req = { method, on(event, fn) {
    if (event === 'data') { if (body !== undefined) fn(Buffer.from(JSON.stringify(body))); }
    else if (event === 'end') fn();
    return req;
  } };
  let resolveEnd;
  const ended = new Promise((resolvePromise) => { resolveEnd = resolvePromise; });
  const res = {
    status: 0,
    payload: '',
    writeHead(code) { res.status = code; },
    end(text) {
      if (text !== undefined) res.payload = text;
      resolveEnd();
    },
  };
  handler(req, res);
  await ended;
  return { status: res.status, body: res.payload === '' ? null : JSON.parse(res.payload) };
}

const assistantEvent = { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '已完成分页接口' }] } } };
const userEvent = { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '做一下分页' }] } };

function stubServices(text = '先跑一遍单元测试') {
  const calls = [];
  const llm = {
    prepareCall: async (config) => ({ config, stream: async function* () {
      calls.push(config);
      yield { type: 'text-delta', text };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }),
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }),
    listProviders: async () => [{ id: 'p', name: 'P' }],
    listModels: async () => [{ id: 'm', name: 'M' }],
  };
  const sessionQuery = { readSurface: async () => ({ events: [userEvent, assistantEvent] }) };
  const agentDefaultModel = { currentSelection: () => ({ provider: 'p', model: 'm' }) };
  return { llm, sessionQuery, agentDefaultModel, calls };
}

// ── ⑦ GET /settings 必须给出「恢复默认」按钮要读的字段 ──────────────────────

test('GET /settings 的 defaults 带上两个上限默认值', async () => {
  const home = await makeHome();
  const { routes } = boot();
  const { status, body } = await call(routes, '/plugins/prompt-suggest/settings', { method: 'GET' });
  assert.equal(status, 200);
  // 前端「恢复默认」直接读这两个字段：缺了按钮就静默无效
  assert.equal(body.defaults.draftMaxChars, DRAFT_MAX_CHARS);
  assert.equal(body.defaults.templateMaxChars, TEMPLATE_MAX_CHARS);
  assert.equal(body.defaults.suggestPrompt, DEFAULT_TEMPLATES.suggest);
  assert.equal(body.defaults.polishPrompt, DEFAULT_TEMPLATES.polish);
  assert.equal(typeof body.defaults.samples.draft, 'string');
  await rm(home, { recursive: true, force: true });
});

test('POST /settings 恢复默认：把上限写回默认值', async () => {
  const home = await makeHome();
  await writeSettings(home, { draftMaxChars: 500, templateMaxChars: 600 });
  const { routes } = boot();
  const { status, body } = await call(routes, '/plugins/prompt-suggest/settings', {
    body: { draftMaxChars: DRAFT_MAX_CHARS, templateMaxChars: TEMPLATE_MAX_CHARS },
  });
  assert.equal(status, 200);
  assert.equal(body.settings.draftMaxChars, DRAFT_MAX_CHARS);
  assert.equal(body.settings.templateMaxChars, TEMPLATE_MAX_CHARS);
  await rm(home, { recursive: true, force: true });
});

// ── ⑨ 预览 / 试跑的长度口径 ─────────────────────────────────────────────────

test('预览不被已保存的较小模板上限卡住（读的是编辑框内容）', async () => {
  const home = await makeHome();
  await writeSettings(home, { templateMaxChars: 100 });
  const { routes } = boot();
  const { status, body } = await call(routes, '/plugins/prompt-suggest/preview', {
    body: {
      mode: 'suggest',
      template: DEFAULT_TEMPLATES.suggest,
      userText: 'u',
      assistantText: 'a',
    },
  });
  assert.equal(status, 200);
  assert.equal(typeof body.prompt, 'string');
  await rm(home, { recursive: true, force: true });
});

test('预览仍然拒绝缺少必需占位符的模板', async () => {
  const home = await makeHome();
  const { routes } = boot();
  const { status, body } = await call(routes, '/plugins/prompt-suggest/preview', {
    body: { mode: 'suggest', template: '只有 {{userText}}' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /缺少必需的占位符/);
  await rm(home, { recursive: true, force: true });
});

// ── ② 试跑校验失败也要落盘 ──────────────────────────────────────────────────

test('试跑遇到不合格模板时写入 last-error.json', async () => {
  const home = await makeHome();
  const { routes } = boot(stubServices());
  const { status } = await call(routes, '/plugins/prompt-suggest/trial', {
    body: { mode: 'suggest', template: '没有占位符' },
  });
  assert.equal(status, 400);
  const record = await readLastError(home);
  assert.equal(record.source, 'trial');
  assert.match(record.error, /缺少必需的占位符/);
  await rm(home, { recursive: true, force: true });
});

test('试跑遇到超限草稿时写入 last-error.json', async () => {
  const home = await makeHome();
  await writeSettings(home, { draftMaxChars: 10 });
  const { routes } = boot(stubServices());
  const { status } = await call(routes, '/plugins/prompt-suggest/trial', {
    body: {
      mode: 'polish',
      template: DEFAULT_TEMPLATES.polish,
      draft: 'x'.repeat(50),
    },
  });
  assert.equal(status, 413);
  const record = await readLastError(home);
  assert.equal(record.source, 'trial');
  assert.match(record.error, /超过 10 字符/);
  await rm(home, { recursive: true, force: true });
});

// ── ① 已保存模板损坏时，生成要报错而不是把坏模板发出去 ──────────────────────

test('生成时拒绝 settings.json 里损坏的模板，并写入诊断日志', async () => {
  const home = await makeHome();
  await writeSettings(home, { suggestPrompt: '坏模板，没有占位符' });
  const services = stubServices();
  const { routes } = boot(services);
  const { status, body } = await call(routes, '/plugins/prompt-suggest/generate', {
    body: { sessionId: 's1', draft: '' },
  });
  assert.equal(status, 500);
  assert.match(body.error, /保存的提示词模板不可用/);
  // 坏模板绝不能到达模型
  assert.equal(services.calls.length, 0);
  const record = await readLastError(home);
  assert.equal(record.source, 'generate');
  await rm(home, { recursive: true, force: true });
});

test('生成时使用合法的自定义模板，素材被注入', async () => {
  const home = await makeHome();
  await writeSettings(home, { suggestPrompt: '自定义：{{userText}} / {{assistantText}}' });
  const services = stubServices('跑一下构建');
  const { routes } = boot(services);
  const { status, body } = await call(routes, '/plugins/prompt-suggest/generate', {
    body: { sessionId: 's1', draft: '' },
  });
  assert.equal(status, 200);
  assert.equal(body.text, '跑一下构建');
  assert.equal(services.calls.length, 1);
  await rm(home, { recursive: true, force: true });
});

// ── ④ 模型下拉的分隔符 ──────────────────────────────────────────────────────

test('模型下拉用 U+0000 分隔 provider 与 model（client 侧常量）', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  // provider id 里可能出现 "::"，分隔符必须是不可能出现的字符
  assert.ok(source.includes('\\u0000'), 'client.js 应使用 \\u0000 作为分隔符');
  assert.equal(source.includes('+ "::" +'), false, 'client.js 不应再用 "::" 拼接');
});
