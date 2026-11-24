// dsh-prompt-suggest — host 面
//
// 职责：一条 HTTP 路由 + 一次辅助 LLM 调用。不碰会话存储之外的状态。
//
// - 路由：POST /plugins/prompt-suggest/generate
//     请求 { sessionId, draft, provider, model, reasoningEffort? }
//     响应 { ok: true, text } | { ok: false, error }
//   GET  /plugins/prompt-suggest/settings   读偏好（模型 + 思考强度）
//   POST /plugins/prompt-suggest/settings   写偏好（只接受已知字段）
//   GET  /plugins/prompt-suggest/models     可选模型与各自的思考档位
// - 会话上下文：ctx.sessionQuery.readSurface(sessionId) 取当前模型表面事件，
//   倒序找最近一轮 user/message + assistant/message（lib/prompt.js 提取）。
// - 模型调用：ctx.get('llm').prepareCall({ provider, model, maxTokens, reasoningEffort? })
//   → call.stream({ ...call.config, messages, system, signal })；只拼 text-delta。
// - mode:draft 为空 → 'suggest'（生成建议）；非空 → 'polish'（润色草稿）。
// - 诊断日志：~/.dsh/storages/prompt-suggest/last-error.json（最近一次失败）。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  GENERATE_TIMEOUT_MS,
  buildPrompt,
  draftTooLong,
  extractLastTurnText,
  sanitizeOutput,
} from './prompt.js';
import {
  DEFAULT_SETTINGS,
  listReasoningEfforts,
  mergeSettings,
  normalizeSettings,
  pickReasoningEffort,
} from './settings.js';

export const name = 'prompt-suggest';

/**
 * 无 Config 项：偏好（模型与思考强度）存在插件自己的 settings.json 里，
 * 由设置页通过 /plugins/prompt-suggest/settings 读写，不占 profile 的 config。
 */
export const Config = undefined;

// 输出 token 与字符上限必须自洽。中文 1 字≈1+ token。
//
// suggest 曾经只有 256：那时它不传思考档位，以为「不传＝不思考」，实际是让模型
// 用自己的默认档（本机 deepseek-v4.1-flash 的 defaultEffort 是 high）——256 token
// 全被思考吃掉，20 秒内等不到一个 text-delta，最终以「生成超时」失败。
// 现在给出足够余量：建议本身 ≤120 字符只占约 120 token，剩下的留给思考。
// maxTokens 是上限不是计费，模型提前停下不会多花。
const SUGGEST_MAX_TOKENS = 4096;
const POLISH_MAX_TOKENS = 16384;
const REQUEST_BODY_MAX_BYTES = 512 * 1024;
/** 设置页拉模型目录的单项查询上限：慢 adapter 不该把下拉拖死。 */
const MODELS_LOOKUP_TIMEOUT_MS = 10_000;

// ── HTTP 工具（webServer 路由用，whale-bubble 同款）─────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req, maxBytes = REQUEST_BODY_MAX_BYTES) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 读完请求体并解析成 JSON 对象。
 * 三条写路由都要做同一件事，失败原因也相同，抽成一个地方以免三份措辞漂移。
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<{ value: object } | { status: number, error: string }>}
 */
async function parseJsonBody(req) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return { status: 413, error: error && error.message ? error.message : '读取请求体失败' };
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return { status: 400, error: '请求体不是合法 JSON' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 400, error: '请求体必须是 JSON 对象' };
  }
  return { value };
}

function fail(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

// ── 诊断日志 ──────────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), '.dsh');
}

async function recordFailure(record) {
  try {
    const dir = join(dshHome(), 'storages', 'prompt-suggest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'last-error.json'), JSON.stringify({
      at: new Date().toISOString(),
      ...record,
    }, null, 2), 'utf8');
  } catch {
    // 诊断日志只是旁路：写失败不影响本次生成结果，也不该反噬主流程
  }
}

// ── 偏好持久化：模型路由与思考强度 ────────────────────────────────────────────

function settingsPath() {
  return join(dshHome(), 'storages', 'prompt-suggest', 'settings.json');
}

/** 读偏好。文件不存在 / 损坏 / 字段非法都返回默认值，绝不抛。 */
async function readSettings() {
  try {
    const raw = await readFile(settingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 偏好写入队列。
 *
 * 只串行化「写」是不够的：两个并发 POST 会各自先读到同一份旧值，再各自 merge，
 * 后落盘的那次把先落盘的那次整个覆盖掉。所以读-改-写必须整体进队列，
 * 让每次提交都基于上一次已经落盘的结果。
 */
let settingsChain = Promise.resolve();

/**
 * 在当前设置上应用一次补丁并落盘。
 * 先写临时文件再 rename，避免半截 JSON 留在盘上。
 * @param {(current: object) => object} mutate 基于最新已落盘设置算出新设置
 * @returns {Promise<object>} 落盘后的设置
 */
function updateSettings(mutate) {
  const task = settingsChain.then(async () => {
    const next = mutate(await readSettings());
    const dir = join(dshHome(), 'storages', 'prompt-suggest');
    await mkdir(dir, { recursive: true });
    const file = settingsPath();
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
    await rename(temp, file);
    return next;
  });
  // 失败也要让队列继续：否则一次写失败会把后续所有保存卡住。
  settingsChain = task.then(() => undefined, () => undefined);
  return task;
}

// ── 会话上下文与生成 ──────────────────────────────────────────────────────────

/** 校验请求体（已解析的对象），返回 { sessionId, draft, provider?, model?, reasoningEffort? } 或错误消息。 */
function parseRequest(raw) {
  const { sessionId, draft, provider, model, reasoningEffort } = raw;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return { error: '缺少 sessionId' };
  if (draft !== undefined && typeof draft !== 'string') return { error: 'draft 必须是字符串' };
  // provider/model 可选：缺省时 host 按全局默认模型回落（resolveRoute）。
  const parsed = {
    sessionId,
    draft: typeof draft === 'string' ? draft : '',
    ...(typeof provider === 'string' && provider.length > 0 ? { provider } : {}),
    ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
  };
  if (typeof reasoningEffort === 'string' && reasoningEffort.length > 0) parsed.reasoningEffort = reasoningEffort;
  return parsed;
}

/** 读取会话当前表面，提取最近一轮 user/assistant 文本。 */
async function readConversationTail(ctx, sessionId) {
  const sessionQuery = ctx.get('sessionQuery');
  if (sessionQuery === undefined) throw new Error('sessionQuery 服务不可用');
  const surface = await sessionQuery.readSurface(sessionId);
  return extractLastTurnText(surface.events ?? []);
}

/**
 * 解析模型路由，优先级从高到低：
 * 1. 设置页里固定下来的 provider/model（用户显式选的，最权威）；
 * 2. client 传入的当前会话模型；
 * 3. 全局默认模型。
 * 思考强度同理：设置页填了就盖过会话档位，留空则沿用会话的。
 *
 * @param ctx 插件上下文
 * @param parsed 请求体解析结果
 * @param settings readSettings() 的结果
 */
function resolveRoute(ctx, parsed, settings) {
  const pinned = settings !== null && typeof settings === 'object' && settings.provider !== '' && settings.model !== '';
  let route;
  if (pinned) {
    route = { provider: settings.provider, model: settings.model };
  } else if (parsed.provider && parsed.model) {
    route = { provider: parsed.provider, model: parsed.model };
  } else {
    const defaults = ctx.get('agentDefaultModel');
    const sel = defaults !== undefined && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : undefined;
    if (sel && sel.provider && sel.model) route = { provider: sel.provider, model: sel.model };
  }
  if (route === undefined) throw new Error('无法确定会话或默认模型路由');
  const effort = settings !== null && typeof settings === 'object' && settings.reasoningEffort !== ''
    ? settings.reasoningEffort
    : parsed.reasoningEffort;
  return effort === undefined ? route : { ...route, reasoningEffort: effort };
}

/**
 * 把用户选的思考强度对齐到模型真正公布的档位。
 *
 * prepareCall 对两种情形会直接抛 UNSUPPORTED_REASONING_EFFORT：模型没有
 * reasoning 元数据却传了档位，或档位不在它公布的列表里。所以这里先问一次
 * resolveModelInfo，只在该模型确实支持时才把值传下去——否则什么都不传，
 * 让模型用自己的默认。resolveModelInfo 失败同样按"不支持"处理。
 */
async function resolveEffort(llm, route, signal) {
  const requested = route.reasoningEffort;
  if (requested === undefined) return undefined;
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model, signal);
    return pickReasoningEffort(info, requested);
  } catch {
    return undefined;
  }
}

/** 一次辅助 LLM 调用；返回拼接后的全部输出文本。 */
async function runLlm(ctx, request) {
  const llm = ctx.get('llm');
  if (llm === undefined || typeof llm.prepareCall !== 'function') throw new Error('llm 服务不可用');

  const maxTokens = request.mode === 'polish' ? POLISH_MAX_TOKENS : SUGGEST_MAX_TOKENS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('生成超时')), GENERATE_TIMEOUT_MS);
  try {
    // 档位查询也在超时范围内：它同样是一次 adapter 往返，不该绕过总预算。
    const effort = await resolveEffort(llm, request, controller.signal);
    const callConfig = {
      provider: request.provider,
      model: request.model,
      maxTokens,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    };
    const call = await llm.prepareCall(callConfig, controller.signal);
    const options = {
      ...call.config,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: request.prompt }],
      }],
      system: request.system,
      signal: controller.signal,
    };
    let text = '';
    let finish;
    for await (const chunk of call.stream(options)) {
      if (controller.signal.aborted) break;
      if (chunk.type === 'text-delta') text += chunk.text;
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
    // 超时/取消后绝不把已累积的半截输出当成功返回
    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason instanceof Error && controller.signal.reason.message
        ? controller.signal.reason.message
        : '生成超时或已取消');
    }
    const kind = finish && finish.kind;
    if (kind === 'error' || kind === 'aborted') {
      throw new Error(finish.failure && finish.failure.message ? finish.failure.message : `生成失败（${kind}）`);
    }
    if (text.trim().length === 0 && kind !== 'stop') {
      throw new Error('模型没有返回文本');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ── 插件主体 ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  let routesRegistered = false;

  const handleGenerate = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-length': 0 });
      res.end();
      return;
    }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) {
      fail(res, body.status, body.error);
      return;
    }
    const parsed = parseRequest(body.value);
    if (parsed.error !== undefined) {
      fail(res, 400, parsed.error);
      return;
    }
    const mode = parsed.draft.trim() === '' ? 'suggest' : 'polish';
    if (mode === 'polish') {
      // 超限明确拒绝，而不是截一半再改写：静默丢尾部会让用户以为润色了全文。
      const tooLong = draftTooLong(parsed.draft);
      if (tooLong !== null) {
        fail(res, 413, tooLong);
        return;
      }
    }
    // 提到 try 外：失败日志要记录实际用的路由，catch 里必须还能读到它。
    let route;
    try {
      const tail = await readConversationTail(ctx, parsed.sessionId);
      if (mode === 'suggest' && tail.assistantText.trim() === '') {
        fail(res, 409, '当前会话还没有代理回复，无法生成建议');
        return;
      }
      const prompt = buildPrompt(mode, {
        draft: parsed.draft,
        userText: tail.userText,
        assistantText: tail.assistantText,
      });
      // 设置页固定下来的模型与思考强度优先于会话选择。
      route = resolveRoute(ctx, parsed, await readSettings());
      const raw = await runLlm(ctx, {
        mode,
        prompt,
        provider: route.provider,
        model: route.model,
        // 两个模式都应用用户选的档位：设置里选 off 就该真的不思考，
        // 只在 client 或 host 单边吞掉档位都会让「设为 off 却仍在思考」无声发生。
        reasoningEffort: route.reasoningEffort,
      });
      // suggest：与"开发者最近一条消息"去重（case/空白归一化）；
      // polish：把草稿原样传下去，由 polishCap 决定这条结果能有多长。
      const text = sanitizeOutput(raw, mode, mode === 'polish' ? parsed.draft : tail.userText);
      if (text === null) {
        fail(res, 422, mode === 'suggest'
          ? '模型没有给出有效的单行建议，可重试'
          : '模型没有返回有效的润色结果，可重试');
        return;
      }
      sendJson(res, 200, { ok: true, text });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      // 记实际用的路由（可能来自设置页），不是 client 报上来的那个：
      // 失败后要能核对「到底是谁在跑、带了什么思考档位」。
      void recordFailure({
        sessionId: parsed.sessionId,
        mode,
        provider: route !== undefined ? route.provider : parsed.provider,
        model: route !== undefined ? route.model : parsed.model,
        reasoningEffort: route !== undefined && route.reasoningEffort !== undefined ? route.reasoningEffort : '',
        error: message,
      });
      // 页面只给通用文案；原始错误已落盘 last-error.json 供排查
      fail(res, 502, '生成失败：模型调用未成功，可重试；详情见 ~/.dsh/storages/prompt-suggest/last-error.json');
    }
  };

  // ── 设置路由 ────────────────────────────────────────────────────────────────

  /** 列出可选模型，附带每个模型公布的思考档位，供设置页渲染两个下拉。 */
  const handleModels = async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', 'content-length': 0 });
      res.end();
      return;
    }
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.listProviders !== 'function') {
      fail(res, 503, 'llm 服务不可用');
      return;
    }
    try {
      // 打开设置页只该等一次往返量级，所以渠道内与渠道间都并行。
      // 每个查询各带一个超时：某个慢 adapter 不能把整个下拉拖死。
      const signal = AbortSignal.timeout(MODELS_LOOKUP_TIMEOUT_MS);
      const describe = async (provider) => {
        const id = provider && typeof provider.id === 'string' ? provider.id : '';
        if (id === '') return undefined;
        let models;
        try {
          models = await llm.listModels(id);
        } catch {
          // 单个渠道取不到目录不该让整个下拉空掉，跳过它继续。
          return undefined;
        }
        const entries = await Promise.all(models.map(async (model) => {
          let efforts = [];
          try {
            efforts = listReasoningEfforts(await llm.resolveModelInfo(id, model.id, signal));
          } catch {
            // 拿不到元数据就当作「不支持调节」，界面据此置灰，而不是猜一个档位出来。
            efforts = [];
          }
          return {
            id: model.id,
            name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
            efforts,
          };
        }));
        if (entries.length === 0) return undefined;
        return {
          id,
          name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : id,
          models: entries,
        };
      };
      const groups = (await Promise.all(llm.listProviders().map(describe))).filter((group) => group !== undefined);
      sendJson(res, 200, { ok: true, groups });
    } catch (error) {
      fail(res, 502, error && error.message ? error.message : '读取模型列表失败');
    }
  };

  /** 读 / 写偏好。写只接受 normalizeSettings 认识的字段。 */
  const handleSettings = async (req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, settings: await readSettings() });
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, POST', 'content-length': 0 });
      res.end();
      return;
    }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) {
      fail(res, body.status, body.error);
      return;
    }
    const patch = body.value;
    try {
      // 读-改-写整体排队：并发保存不会各自基于旧值覆盖对方。
      const next = await updateSettings((current) => mergeSettings(current, patch));
      sendJson(res, 200, { ok: true, settings: next });
    } catch (error) {
      fail(res, 500, error && error.message ? error.message : '保存设置失败');
    }
  };

  const registerRoutes = () => {
    const web = ctx.get('webServer');
    if (web === undefined) return false;
    if (routesRegistered) return true;
    routesRegistered = true;
    const disposers = [
      web.register({
        kind: 'exact',
        path: '/plugins/prompt-suggest/generate',
        handler: (req, res) => { void handleGenerate(req, res); },
      }),
      web.register({
        kind: 'exact',
        path: '/plugins/prompt-suggest/settings',
        handler: (req, res) => { void handleSettings(req, res); },
      }),
      web.register({
        kind: 'exact',
        path: '/plugins/prompt-suggest/models',
        handler: (req, res) => { void handleModels(req, res); },
      }),
    ];
    ctx.effect(
      () => () => {
        for (const dispose of disposers) {
          // 卸载清理逐个尽力执行：单个 dispose 抛错不能留下未清理的路由
          try { dispose(); } catch {}
        }
      },
      'prompt-suggest: routes',
    );
    return true;
  };

  // webServer 可能晚于本插件 apply 绑定（Service.init 异步）：首次失败时挂 internal/service 补注册。
  if (!registerRoutes()) {
    ctx.on('internal/service', (svcName) => {
      if (svcName === 'webServer') registerRoutes();
    });
  }
}
