// dsh-note-tabs — host 面
//
// 职责：把便签落盘（单文件 JSON + 临时文件 rename 原子写），并通过一条
// webServer 路由把读写能力交给 client 面。不注册 Agent 工具（Q18）。
//
// 通道说明：本机 DSH 0.2.x 没有向「已安装的 client bundle」暴露 host.call
// 桥（host.call 只属于动态 Cordis 包），因此走与 dsh-prompt-suggest /
// dsh-whale-bubble / dsh-github-trending 同一条 HTTP 路由。
//
// 路由：POST /plugins/note-tabs/rpc
//   { op: 'state' }
//   { op: 'add', payload: { text, workspaceId, sessionId } }
//   { op: 'update', payload: { id, text } }
//   { op: 'remove', payload: { id } }
//   { op: 'restore', payload: { note, index } }
//   { op: 'settings', payload: { patch } }
//   → { ok: true, store } | { ok: false, error }

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import {
  addNote,
  emptyStore,
  normalizeStore,
  patchSettings,
  removeNote,
  restoreNote,
  updateNote,
} from './notes.js';

export const name = 'note-tabs';

/** 无配置项：偏好存在 notes.json 的 settings 字段里，由设置页写入。 */
export const Config = undefined;

const ROUTE = '/plugins/note-tabs/rpc';
const REQUEST_BODY_MAX_BYTES = 2 * 1024 * 1024;

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), '.dsh');
}

function storePath() {
  return join(dshHome(), 'storages', 'dsh-note-tabs', 'notes.json');
}

// ── 读写 ──────────────────────────────────────────────────────────────────────

/** 串行化所有写：并发收藏/删除不会互相覆盖。 */
let writeChain = Promise.resolve();

/** 读盘；文件不存在或损坏时回退空存储（坏文件另存 .bak 供排查）。 */
async function readStore() {
  const file = storePath();
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    // 坏文件不静默丢弃：留一份 .bak，再以空存储继续。
    // 只在 .bak 还不存在时写——否则每次读都会重写一遍，mtime 一直抖。
    try {
      await writeFile(file + '.bak', raw, { encoding: 'utf8', flag: 'wx' });
    } catch {
      // 备份失败（含 .bak 已存在）不阻断：本次仍以空存储服务
    }
    return emptyStore();
  }
}

/** 临时文件 + rename 原子写；同一目录才能保证 rename 原子。 */
async function writeStore(store) {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + Date.now().toString(36)
    + Math.random().toString(36).slice(2, 6) + '.tmp';
  await writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
  await rename(temp, file);
}

/** 读-改-写整体串行执行，返回本次结果与新存储。 */
function mutate(fn) {
  const run = writeChain.then(async () => {
    const store = await readStore();
    const outcome = fn(store);
    // 无变化（重复收藏、删不存在的 id、非法编辑）不落盘，避免无谓写与 mtime 抖动
    if (outcome.store !== store) await writeStore(outcome.store);
    return outcome;
  });
  // 链上吞掉失败，避免一次写失败卡住后续所有请求
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

// ── HTTP 工具 ─────────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = REQUEST_BODY_MAX_BYTES) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      // 超限后必须停止继续缓冲：销毁请求，后续 data/end 不再进入本 Promise
      req.destroy();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new Error('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => { fail(error); });
  });
}

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

// ── 路由处理 ──────────────────────────────────────────────────────────────────

async function handleRpc(body) {
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    return { status: 400, payload: { ok: false, error: '请求体不是合法 JSON' } };
  }
  if (request === null || typeof request !== 'object') {
    return { status: 400, payload: { ok: false, error: '请求体必须是 JSON 对象' } };
  }
  const payload = request.payload !== null && typeof request.payload === 'object' ? request.payload : {};
  switch (request.op) {
    case 'state':
      return { status: 200, payload: { ok: true, store: await readStore() } };
    case 'add': {
      const outcome = await mutate((store) => addNote(store, {
        text: payload.text,
        workspaceId: str(payload.workspaceId),
        sessionId: str(payload.sessionId),
      }));
      if (outcome.note === null) {
        const code = outcome.reason === 'full' ? 'full' : 'empty';
        const error = code === 'full' ? '便签数量已达上限' : '正文为空，无法收藏';
        return { status: 422, payload: { ok: false, code, error } };
      }
      return { status: 200, payload: { ok: true, store: outcome.store, note: outcome.note, added: outcome.added } };
    }
    case 'update': {
      const outcome = await mutate((store) => updateNote(store, payload.id, payload.text));
      if (outcome.note === null) {
        const code = outcome.reason === 'empty' ? 'empty'
          : outcome.reason === 'duplicate' ? 'duplicate'
            : 'missing';
        const message = code === 'empty' ? '正文不能为空'
          : code === 'duplicate' ? '已有内容相同的便签'
            : '便签不存在';
        return { status: 422, payload: { ok: false, code, error: message } };
      }
      return { status: 200, payload: { ok: true, store: outcome.store, note: outcome.note } };
    }
    case 'remove': {
      const outcome = await mutate((store) => removeNote(store, payload.id));
      if (outcome.removed === null) return { status: 404, payload: { ok: false, code: 'missing', error: '便签不存在' } };
      return { status: 200, payload: { ok: true, store: outcome.store, removed: outcome.removed } };
    }
    case 'restore': {
      const outcome = await mutate((store) => {
        const result = restoreNote(store, payload.note, Number.isInteger(payload.index) ? payload.index : 0);
        return { store: result.store, restored: result.restored, reason: result.reason };
      });
      if (outcome.restored === null) {
        // 撤销失败必须让前端知道：否则 Toast 弹了「已撤销」但其实什么都没插回去。
        const code = outcome.reason === 'duplicate' ? 'duplicate'
          : outcome.reason === 'id-exists' ? 'id-exists' : 'invalid';
        const error = code === 'duplicate' ? '正文相同的便签已存在，无法撤销'
          : code === 'id-exists' ? '这条便签已经存在'
            : '撤销的内容无效';
        return { status: 409, payload: { ok: false, code, error, store: outcome.store } };
      }
      return { status: 200, payload: { ok: true, store: outcome.store, note: outcome.restored } };
    }
    case 'settings': {
      const outcome = await mutate((store) => ({ store: patchSettings(store, payload.patch) }));
      return { status: 200, payload: { ok: true, store: outcome.store } };
    }
    default:
      return { status: 400, payload: { ok: false, code: 'unknown-op', error: '未知操作：' + String(request.op) } };
  }
}

export function apply(ctx) {
  let registered = false;

  const handle = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-length': 0 });
      res.end();
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      sendJson(res, 413, { ok: false, error: error && error.message ? error.message : '读取请求体失败' });
      return;
    }
    try {
      const result = await handleRpc(body);
      sendJson(res, result.status, result.payload);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
    }
  };

  const register = () => {
    const web = ctx.get('webServer');
    if (web === undefined) return false;
    if (registered) return true;
    const dispose = web.register({
      kind: 'exact',
      path: ROUTE,
      handler: (req, res) => { void handle(req, res); },
    });
    // 登记成功后才置位：register 抛错时后续 internal/service 仍会重试
    registered = true;
    ctx.effect(
      () => () => {
        try { dispose(); } catch {}
      },
      'note-tabs: route',
    );
    return true;
  };

  // webServer 可能晚于本插件 apply 绑定：首次失败时挂 internal/service 补注册。
  if (!register()) {
    const off = ctx.on('internal/service', (svcName) => {
      if (svcName !== 'webServer') return;
      if (register()) off();
    });
    // 插件卸载时同步摘掉监听，否则 webServer 一直不出现会永久驻留。
    ctx.effect(() => () => { try { off(); } catch {} }, 'note-tabs: service listener');
  }
}
