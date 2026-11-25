// dsh-prompt-suggest — host 面
//
// 职责：HTTP 路由 + 一次辅助 LLM 调用。不碰会话存储之外的状态。
//
// - 生成：POST /plugins/prompt-suggest/generate
//     请求 { sessionId, draft, provider?, model?, reasoningEffort? }
//     响应 { ok: true, text } | { ok: false, error }
//     mode:draft 为空 → 'suggest'；非空 → 'polish'。模板取已保存的设置，没有则用内置默认。
// - 预览：POST /plugins/prompt-suggest/preview（不调用模型）
//     请求 { mode, template, draft, userText, assistantText }，template 为编辑框当前内容（可未保存）
//     响应 { ok: true, prompt }
// - 试跑：POST /plugins/prompt-suggest/trial（调用模型，不写会话、不写输入框）
//     请求同预览；路由为设置页固定模型，否则全局默认；思考强度沿用设置页
//     响应 { ok: true, text, route }
// - 设置：GET/POST /plugins/prompt-suggest/settings（POST 先校验再落盘）
// - 模型目录：GET /plugins/prompt-suggest/models
// - 诊断日志：~/.dsh/storages/prompt-suggest/last-error.json（最近一次失败，含空输出）。
//
// 输出不做清洗：模型返回什么就是什么，只拒绝空输出。两种输出都先呈现给用户再生效。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  DEFAULT_TEMPLATES,
  DRAFT_MAX_CHARS,
  GENERATE_TIMEOUT_MS,
  LIMIT_MAX_CHARS,
  SAMPLES,
  TEMPLATE_MAX_CHARS,
  buildPrompt,
  draftTooLong,
  extractLastTurnText,
  validateTemplate,
} from './prompt.js';
import {
  DEFAULT_SETTINGS,
  listReasoningEfforts,
  mergeSettings,
  normalizeSettings,
  pickReasoningEffort,
  validateSettingsPatch,
} from './settings.js';

export const name = 'prompt-suggest';

/**
 * 无 Config 项：偏好（模型、思考强度、模板、上限）存在插件自己的 settings.json 里，
 * 由设置页通过 /plugins/prompt-suggest/settings 读写，不占 profile 的 config。
 */
export const Config = undefined;

// 输出 token 上限。maxTokens 是上限不是计费，模型提前停下不会多花。
// suggest 留足余量给思考：建议本身约 60 字，其余预算由模型自己的思考消耗。
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
 * 读完请求体并解析成 JSON 对象。四条写路由都要做同一件事，失败原因也相同，抽成一个地方。
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

function methodNotAllowed(req, res, allow) {
  res.writeHead(405, { allow, 'content-length': 0 });
  res.end();
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
    // 诊断日志只是旁路：写失败不影响本次结果，也不该反噬主流程
  }
}

// ── 偏好持久化 ────────────────────────────────────────────────────────────────

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
 * 偏好写入队列。读-改-写必须整体进队列，否则两个并发 POST 会各自基于同一份旧值，
 * 后落盘的那次把先落盘的覆盖掉。
 */
let settingsChain = Promise.resolve();

/** 设置补丁校验失败：区别于写盘失败，映射为 400。 */
class SettingsValidationError extends Error {}

/**
 * 在当前设置上应用一次补丁并落盘。校验放在队列里做，因为它依赖当前已落盘的上限与模板。
 * 先写临时文件再 rename，避免半截 JSON 留在盘上。
 * @param {(current: object) => object} mutate
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

// ── 会话上下文与路由 ──────────────────────────────────────────────────────────

/** 校验生成请求体，返回 { sessionId, draft, provider?, model?, reasoningEffort? } 或 { error }。 */
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

/**
 * 校验预览 / 试跑请求体。template 必须是非空字符串（编辑框内容，可未保存）。
 *
 * 长度口径与保存不同：已保存模板的 templateMaxChars 是保存策略，而预览/试跑读的是
 * 尚未保存的编辑内容——用户把上限调高但还没保存时，旧上限不该把试跑卡住。
 * 所以这里只校验占位符结构与硬上限 LIMIT_MAX_CHARS。
 * @returns {{ value: object } | { status: number, error: string }}
 */
function parsePromptRequest(raw) {
  const { mode, template, draft = '', userText = '', assistantText = '' } = raw;
  if (mode !== 'suggest' && mode !== 'polish') return { status: 400, error: 'mode 必须是 suggest 或 polish' };
  for (const [key, value] of Object.entries({ template, draft, userText, assistantText })) {
    if (key !== 'template' && value !== undefined && typeof value !== 'string') {
      return { status: 400, error: `${key} 必须是字符串` };
    }
  }
  if (typeof template !== 'string') return { status: 400, error: 'template 必须是字符串' };
  const message = validateTemplate(mode, template, LIMIT_MAX_CHARS);
  if (message !== null) return { status: 400, error: message };
  return { value: { mode, template, draft, userText, assistantText } };
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
 * 2. 请求里带的会话模型（生成时）；
 * 3. 全局默认模型。
 * 思考强度：设置页填了就盖过请求带来的档位，留空则沿用请求的。
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
 * prepareCall 对不支持的档位会直接抛错，所以先查一次模型元数据；不支持就不传，用模型默认。
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

/**
 * 一次辅助 LLM 调用；返回拼接后的全部输出文本（不做清洗）。
 * 超时/取消、错误结束都抛出，绝不把半截输出当成功返回。
 */
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
      signal: controller.signal,
    };
    let text = '';
    let finish;
    for await (const chunk of call.stream(options)) {
      if (controller.signal.aborted) break;
      if (chunk.type === 'text-delta') text += chunk.text;
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
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

/** 空输出是唯一的输出校验：模型返回空白即失败，写入诊断日志。 */
function requireNonEmpty(text) {
  if (text.trim().length === 0) throw new Error('模型输出为空');
  return text.trim();
}

// ── 插件主体 ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  let routesRegistered = false;

  /** 生成建议 / 润色：使用已保存的模板，草稿超过设置的上限则拒绝。 */
  const handleGenerate = async (req, res) => {
    if (req.method !== 'POST') { methodNotAllowed(req, res, 'POST'); return; }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) { fail(res, body.status, body.error); return; }
    const parsed = parseRequest(body.value);
    if (parsed.error !== undefined) { fail(res, 400, parsed.error); return; }
    const mode = parsed.draft.trim() === '' ? 'suggest' : 'polish';
    // 提到 try 外：失败日志要记录实际用的路由。
    let route;
    try {
      const settings = await readSettings();
      if (mode === 'polish') {
        // 超限明确拒绝，而不是截一半再改写：静默丢尾部会让用户以为润色了全文。
        const tooLong = draftTooLong(parsed.draft, settings.draftMaxChars);
        if (tooLong !== null) { fail(res, 413, tooLong); return; }
      }
      const tail = await readConversationTail(ctx, parsed.sessionId);
      if (mode === 'suggest' && tail.assistantText.trim() === '') {
        fail(res, 409, '当前会话还没有代理回复，无法生成建议');
        return;
      }
      const template = mode === 'polish' ? settings.polishPrompt : settings.suggestPrompt;
      // 保存时已校验过一次，但 settings.json 可能被手工改坏或来自旧版本：
      // 不兜底的话未知占位符会原样写进提示词，模型收到一段没人看得懂的素材标记。
      // 空串走内置默认，内置默认可信，所以只查自定义模板。
      // 长度按硬上限查而非 templateMaxChars：长度在保存时已是不变量，
      // 这里再按当前上限查，会让「先存长模板、后调低上限」的旧数据直接生成不了。
      if (template !== '') {
        const invalid = validateTemplate(mode, template, LIMIT_MAX_CHARS);
        if (invalid !== null) {
          void recordFailure({
            source: 'generate',
            sessionId: parsed.sessionId,
            mode,
            provider: settings.provider,
            model: settings.model,
            reasoningEffort: settings.reasoningEffort,
            error: `保存的提示词模板不可用：${invalid}`,
          });
          fail(res, 500, `保存的提示词模板不可用：${invalid}；请在设置页修正或恢复默认`);
          return;
        }
      }
      const prompt = buildPrompt(mode, template, {
        draft: parsed.draft,
        userText: tail.userText,
        assistantText: tail.assistantText,
      });
      route = resolveRoute(ctx, parsed, settings);
      const raw = await runLlm(ctx, {
        mode,
        prompt,
        provider: route.provider,
        model: route.model,
        // 两个模式都应用用户选的档位：设置里选 off 就该真的不思考。
        reasoningEffort: route.reasoningEffort,
      });
      sendJson(res, 200, { ok: true, text: requireNonEmpty(raw) });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      void recordFailure({
        source: 'generate',
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

  /** 预览：只组装提示词，不调用模型。模板取编辑框内容（可未保存）。 */
  const handlePreview = async (req, res) => {
    if (req.method !== 'POST') { methodNotAllowed(req, res, 'POST'); return; }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) { fail(res, body.status, body.error); return; }
    try {
      const settings = await readSettings();
      const parsed = parsePromptRequest(body.value);
      if (parsed.error !== undefined) { fail(res, parsed.status, parsed.error); return; }
      const { mode, template, draft, userText, assistantText } = parsed.value;
      if (mode === 'polish') {
        const tooLong = draftTooLong(draft, settings.draftMaxChars);
        if (tooLong !== null) { fail(res, 413, tooLong); return; }
      }
      sendJson(res, 200, { ok: true, prompt: buildPrompt(mode, template, { draft, userText, assistantText }) });
    } catch (error) {
      fail(res, 500, error && error.message ? error.message : '组装提示词失败');
    }
  };

  /**
   * 试跑：用编辑框内容调用模型一次。结果只返回给设置页，不写输入框、不改会话。
   * 路由：设置页固定模型优先，否则全局默认；思考强度沿用设置页。
   */
  const handleTrial = async (req, res) => {
    if (req.method !== 'POST') { methodNotAllowed(req, res, 'POST'); return; }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) { fail(res, body.status, body.error); return; }
    let route;
    let mode = 'suggest';
    let settings;
    /**
     * 校验类失败（模板不合格、草稿超限）同样写诊断日志：
     * 试跑失败后用户看到的就是这条错误，不落盘的话事后无从复核当时用的是哪版模板。
     */
    const rejectTrial = (status, message) => {
      void recordFailure({
        source: 'trial',
        mode,
        provider: settings !== undefined && settings.provider !== '' ? settings.provider : '',
        model: settings !== undefined && settings.model !== '' ? settings.model : '',
        reasoningEffort: settings !== undefined ? settings.reasoningEffort : '',
        error: message,
      });
      fail(res, status, message);
    };
    try {
      settings = await readSettings();
      const parsed = parsePromptRequest(body.value);
      if (parsed.error !== undefined) { rejectTrial(parsed.status, parsed.error); return; }
      const { template, draft, userText, assistantText } = parsed.value;
      mode = parsed.value.mode;
      if (mode === 'polish') {
        const tooLong = draftTooLong(draft, settings.draftMaxChars);
        if (tooLong !== null) { rejectTrial(413, tooLong); return; }
      }
      const prompt = buildPrompt(mode, template, { draft, userText, assistantText });
      route = resolveRoute(ctx, {}, settings);
      const raw = await runLlm(ctx, {
        mode,
        prompt,
        provider: route.provider,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
      });
      sendJson(res, 200, {
        ok: true,
        text: requireNonEmpty(raw),
        route: {
          provider: route.provider,
          model: route.model,
          reasoningEffort: route.reasoningEffort ?? '',
        },
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      void recordFailure({
        source: 'trial',
        mode,
        provider: route !== undefined ? route.provider : '',
        model: route !== undefined ? route.model : '',
        reasoningEffort: route !== undefined && route.reasoningEffort !== undefined ? route.reasoningEffort : '',
        error: message,
      });
      fail(res, 502, `试跑失败：${message}；详情见 ~/.dsh/storages/prompt-suggest/last-error.json`);
    }
  };

  // ── 设置路由 ──────────────────────────────────────────────────────────────

  /** 列出可选模型，附带每个模型公布的思考档位，供设置页渲染两个下拉。 */
  const handleModels = async (req, res) => {
    if (req.method !== 'GET') { methodNotAllowed(req, res, 'GET'); return; }
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

  /**
   * 读 / 写偏好。GET 同时返回内置默认模板、样例素材与上限范围，供设置页展示与恢复默认。
   * POST 先校验再落盘，非法值整体拒绝，不静默回落。
   */
  const handleSettings = async (req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        settings: await readSettings(),
        defaults: {
          suggestPrompt: DEFAULT_TEMPLATES.suggest,
          polishPrompt: DEFAULT_TEMPLATES.polish,
          samples: SAMPLES,
          limitMax: LIMIT_MAX_CHARS,
          // 上限的默认值必须是上面前端「恢复默认」按钮读取的那两个字段名，
          // 否则该按钮发出的补丁是空的，看起来能点、实际什么也没保存。
          draftMaxChars: DRAFT_MAX_CHARS,
          templateMaxChars: TEMPLATE_MAX_CHARS,
        },
      });
      return;
    }
    if (req.method !== 'POST') { methodNotAllowed(req, res, 'GET, POST'); return; }
    const body = await parseJsonBody(req);
    if (body.error !== undefined) { fail(res, body.status, body.error); return; }
    const patch = body.value;
    try {
      const next = await updateSettings((current) => {
        const message = validateSettingsPatch(patch, current);
        if (message !== null) throw new SettingsValidationError(message);
        return mergeSettings(current, patch);
      });
      sendJson(res, 200, { ok: true, settings: next });
    } catch (error) {
      if (error instanceof SettingsValidationError) {
        fail(res, 400, error.message);
        return;
      }
      fail(res, 500, error && error.message ? error.message : '保存设置失败');
    }
  };

  const registerRoutes = () => {
    const web = ctx.get('webServer');
    if (web === undefined) return false;
    if (routesRegistered) return true;
    routesRegistered = true;
    const routes = [
      ['/plugins/prompt-suggest/generate', (req, res) => { void handleGenerate(req, res); }],
      ['/plugins/prompt-suggest/preview', (req, res) => { void handlePreview(req, res); }],
      ['/plugins/prompt-suggest/trial', (req, res) => { void handleTrial(req, res); }],
      ['/plugins/prompt-suggest/settings', (req, res) => { void handleSettings(req, res); }],
      ['/plugins/prompt-suggest/models', (req, res) => { void handleModels(req, res); }],
    ];
    const disposers = routes.map(([path, handler]) => web.register({ kind: 'exact', path, handler }));
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
