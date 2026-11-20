// dsh-prompt-suggest — host 面
//
// 职责：一条 HTTP 路由 + 一次辅助 LLM 调用。不碰会话存储之外的状态。
//
// - 路由：POST /plugins/prompt-suggest/generate
//     请求 { sessionId, draft, provider, model, reasoningEffort? }
//     响应 { ok: true, text } | { ok: false, error }
// - 会话上下文：ctx.sessionQuery.readSurface(sessionId) 取当前模型表面事件，
//   倒序找最近一轮 user/message + assistant/message（lib/prompt.js 提取）。
// - 模型调用：ctx.get('llm').prepareCall({ provider, model, maxTokens, reasoningEffort? })
//   → call.stream({ ...call.config, messages, system, signal })；只拼 text-delta。
// - mode:draft 为空 → 'suggest'（生成建议）；非空 → 'polish'（润色草稿）。
// - 诊断日志：~/.dsh/storages/prompt-suggest/last-error.json（最近一次失败）。

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  GENERATE_TIMEOUT_MS,
  buildPrompt,
  extractLastTurnText,
  sanitizeOutput,
} from './prompt.js';

export const name = 'prompt-suggest';

/** 无配置项；占位以符合官方 Config 形态。 */
export const Config = undefined;

const SUGGEST_MAX_TOKENS = 256;
const POLISH_MAX_TOKENS = 4096;
const REQUEST_BODY_MAX_BYTES = 512 * 1024;

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

// ── 会话上下文与生成 ──────────────────────────────────────────────────────────

/** 校验请求体，返回 { sessionId, draft, provider?, model?, reasoningEffort? } 或错误消息。 */
function parseRequest(body) {
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    return { error: '请求体不是合法 JSON' };
  }
  if (raw === null || typeof raw !== 'object') return { error: '请求体必须是 JSON 对象' };
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

/** 解析模型路由：client 传入的 provider/model 可信时直接用；缺失时按全局默认回落。 */
function resolveRoute(ctx, parsed) {
  if (parsed.provider && parsed.model) {
    return { provider: parsed.provider, model: parsed.model, reasoningEffort: parsed.reasoningEffort };
  }
  const defaults = ctx.get('agentDefaultModel');
  if (defaults !== undefined && typeof defaults.currentSelection === 'function') {
    const sel = defaults.currentSelection();
    if (sel && sel.provider && sel.model) return sel;
  }
  throw new Error('无法确定会话或默认模型路由');
}

/** 一次辅助 LLM 调用；返回拼接后的全部输出文本。 */
async function runLlm(ctx, request) {
  const llm = ctx.get('llm');
  if (llm === undefined || typeof llm.prepareCall !== 'function') throw new Error('llm 服务不可用');

  const maxTokens = request.mode === 'polish' ? POLISH_MAX_TOKENS : SUGGEST_MAX_TOKENS;
  const callConfig = {
    provider: request.provider,
    model: request.model,
    maxTokens,
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('生成超时')), GENERATE_TIMEOUT_MS);
  try {
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
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      fail(res, 413, error && error.message ? error.message : '读取请求体失败');
      return;
    }
    const parsed = parseRequest(body);
    if (parsed.error !== undefined) {
      fail(res, 400, parsed.error);
      return;
    }
    const mode = parsed.draft.trim() === '' ? 'suggest' : 'polish';
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
      const route = resolveRoute(ctx, parsed);
      const raw = await runLlm(ctx, {
        mode,
        prompt,
        provider: route.provider,
        model: route.model,
        reasoningEffort: mode === 'polish' ? route.reasoningEffort : undefined,
      });
      // Pendant 同语义：建议与"开发者最近一条消息"去重（case/空白归一化）
      const text = sanitizeOutput(raw, mode, mode === 'polish' ? '' : tail.userText);
      if (text === null) {
        fail(res, 422, mode === 'suggest'
          ? '模型没有给出有效的单行建议，可重试'
          : '模型没有返回有效的润色结果，可重试');
        return;
      }
      sendJson(res, 200, { ok: true, text });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      void recordFailure({ sessionId: parsed.sessionId, mode, provider: parsed.provider, model: parsed.model, error: message });
      // 页面只给通用文案；原始错误已落盘 last-error.json 供排查
      fail(res, 502, '生成失败：模型调用未成功，可重试；详情见 ~/.dsh/storages/prompt-suggest/last-error.json');
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
