// host 面路由集成测试：假 ctx 装路由，用假 req/res 走 RPC。
// 运行：node --test "dsh-note-tabs/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { apply } from '../lib/index.js';

/** 建一个临时 DSH_HOME 和一个能捕获路由的假 ctx。 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-note-tabs-'));
  process.env.DSH_HOME = home;
  const routes = new Map();
  const effects = [];
  const ctx = {
    get: (name) => (name === 'webServer' ? { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } : undefined),
    effect: (fn) => { effects.push(fn); return () => {}; },
    on: () => () => {},
  };
  apply(ctx);
  const handler = routes.get('/plugins/note-tabs/rpc');
  assert.ok(handler, '路由已注册');

  const call = (payload) => new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = Readable.from([body]);
    req.method = 'POST';
    const chunks = [];
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status; },
      end(text) { resolve({ status: this.statusCode, body: JSON.parse(text) }); },
      write(chunk) { chunks.push(chunk); },
    };
    handler(req, res);
  });

  return {
    call,
    handler,
    home,
    notesPath: join(home, 'storages', 'dsh-note-tabs', 'notes.json'),
    dispose: () => rm(home, { recursive: true, force: true }),
  };
}

test('state 首次调用返回空存储', async () => {
  const h = await harness();
  try {
    const response = await h.call({ op: 'state' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.store.notes, []);
    assert.equal(response.body.store.settings.hoverCount, 10);
  } finally { await h.dispose(); }
});

test('add 落盘，remove 后文件同步变化', async () => {
  const h = await harness();
  try {
    const added = await h.call({ op: 'add', payload: { text: '## 标题\n\n正文', workspaceId: 'w1', sessionId: 's1' } });
    assert.equal(added.status, 200);
    assert.equal(added.body.added, true);
    const onDisk = JSON.parse(await readFile(h.notesPath, 'utf8'));
    assert.equal(onDisk.notes.length, 1);
    assert.equal(onDisk.notes[0].workspaceId, 'w1');

    const removed = await h.call({ op: 'remove', payload: { id: added.body.note.id } });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed.text, '## 标题\n\n正文');
    const after = JSON.parse(await readFile(h.notesPath, 'utf8'));
    assert.deepEqual(after.notes, []);
  } finally { await h.dispose(); }
});

test('重复 add 幂等：added=false 且只有一条', async () => {
  const h = await harness();
  try {
    const first = await h.call({ op: 'add', payload: { text: 'abc  def' } });
    const second = await h.call({ op: 'add', payload: { text: 'ABCDEF' } });
    assert.equal(second.body.added, false);
    assert.equal(second.body.note.id, first.body.note.id);
    assert.equal(second.body.store.notes.length, 1);
  } finally { await h.dispose(); }
});

test('update 空正文与重复正文返回 422', async () => {
  const h = await harness();
  try {
    const a = await h.call({ op: 'add', payload: { text: '甲' } });
    const b = await h.call({ op: 'add', payload: { text: '乙' } });
    const empty = await h.call({ op: 'update', payload: { id: b.body.note.id, text: '   ' } });
    assert.equal(empty.status, 422);
    const duplicate = await h.call({ op: 'update', payload: { id: b.body.note.id, text: '甲' } });
    assert.equal(duplicate.status, 422);
    const ok = await h.call({ op: 'update', payload: { id: b.body.note.id, text: '乙二' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.note.text, '乙二');
    assert.ok(a.body.note.id);
  } finally { await h.dispose(); }
});

test('restore 把撤销的便签放回原位置', async () => {
  const h = await harness();
  try {
    const a = await h.call({ op: 'add', payload: { text: '一' } });
    const b = await h.call({ op: 'add', payload: { text: '二' } });
    const removed = await h.call({ op: 'remove', payload: { id: a.body.note.id } });
    const restored = await h.call({ op: 'restore', payload: { note: removed.body.removed, index: 1 } });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.store.notes.map((note) => note.text), ['二', '一']);
    assert.ok(b.body.note.id);
  } finally { await h.dispose(); }
});

test('restore 遇到同正文已存在时返回 409，而不是假装撤销成功', async () => {
  const h = await harness();
  try {
    const a = await h.call({ op: 'add', payload: { text: '同一段正文' } });
    const removed = await h.call({ op: 'remove', payload: { id: a.body.note.id } });
    await h.call({ op: 'add', payload: { text: '同一段正文' } });
    const restored = await h.call({ op: 'restore', payload: { note: removed.body.removed, index: 0 } });
    // 静默 200 会让前端的「已删除·撤销」Toast 骗人
    assert.equal(restored.status, 409);
    assert.equal(restored.body.ok, false);
    assert.match(restored.body.error, /已存在/);
    assert.equal(restored.body.store.notes.length, 1);
  } finally { await h.dispose(); }
});

test('同值 settings 补丁不重写文件（mtime 不变）', async () => {
  const h = await harness();
  try {
    await h.call({ op: 'settings', payload: { patch: { hoverCount: 20 } } });
    const before = (await stat(h.notesPath)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const again = await h.call({ op: 'settings', payload: { patch: { hoverCount: 20 } } });
    assert.equal(again.status, 200);
    assert.equal(again.body.store.settings.hoverCount, 20);
    assert.equal((await stat(h.notesPath)).mtimeMs, before, '无变化的补丁不该落盘');
  } finally { await h.dispose(); }
});

test('settings 收敛越界值并落盘', async () => {
  const h = await harness();
  try {
    const response = await h.call({ op: 'settings', payload: { patch: { hoverCount: 99, hoverEnabled: false } } });
    assert.equal(response.status, 200);
    assert.equal(response.body.store.settings.hoverCount, 30);
    assert.equal(response.body.store.settings.hoverEnabled, false);
    const onDisk = JSON.parse(await readFile(h.notesPath, 'utf8'));
    assert.equal(onDisk.settings.hoverCount, 30);
  } finally { await h.dispose(); }
});

test('settings 可保存入口位置，包含空数组', async () => {
  const h = await harness();
  try {
    const initial = await h.call({ op: 'state' });
    assert.deepEqual(initial.body.store.settings.entryPositions, ['sidebar', 'header']);

    const headerOnly = await h.call({ op: 'settings', payload: { patch: { entryPositions: ['header'] } } });
    assert.deepEqual(headerOnly.body.store.settings.entryPositions, ['header']);

    const none = await h.call({ op: 'settings', payload: { patch: { entryPositions: [] } } });
    assert.deepEqual(none.body.store.settings.entryPositions, []);
    const onDisk = JSON.parse(await readFile(h.notesPath, 'utf8'));
    assert.deepEqual(onDisk.settings.entryPositions, []);
  } finally { await h.dispose(); }
});

test('坏 JSON 文件回退空存储并留 .bak', async () => {
  const h = await harness();
  try {
    const dir = join(h.home, 'storages', 'dsh-note-tabs');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(h.notesPath, '{ 不是 JSON', 'utf8');
    const response = await h.call({ op: 'state' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.store.notes, []);
    const backup = await readFile(h.notesPath + '.bak', 'utf8');
    assert.equal(backup, '{ 不是 JSON');
  } finally { await h.dispose(); }
});

test('未知 op 与非对象请求体返回 400', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call({ op: 'nope' })).status, 400);
    assert.equal((await h.call([1, 2])).status, 400);
  } finally { await h.dispose(); }
});

test('GET 请求返回 405', async () => {
  const h = await harness();
  try {
    const status = await new Promise((resolve) => {
      const req = Readable.from([]);
      req.method = 'GET';
      const res = {
        statusCode: 0,
        writeHead(value) { this.statusCode = value; },
        end() { resolve(this.statusCode); },
      };
      h.handler(req, res);
    });
    assert.equal(status, 405);
  } finally { await h.dispose(); }
});
