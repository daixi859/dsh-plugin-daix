// lib/notes.js 纯逻辑测试。运行：node --test dsh-note-tabs/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addNote,
  contentKey,
  emptyStore,
  findByContent,
  normalizeSettings,
  normalizeStore,
  normalizeText,
  patchSettings,
  removeNote,
  restoreNote,
  sortedNotes,
  updateNote,
  HOVER_COUNT_DEFAULT,
} from '../lib/notes.js';

const WS = 'w_1';
const SE = 's_1';

// ── 去重键 ───────────────────────────────────────────────────────────────────

test('contentKey 去掉全部空白并小写', () => {
  assert.equal(contentKey('  A b\n\tC '), 'abc');
  assert.equal(contentKey(''), '');
  assert.equal(contentKey(undefined), '');
});

// ── 新增与幂等 ───────────────────────────────────────────────────────────────

test('addNote 落库并保留归属 id', () => {
  const result = addNote(emptyStore(), { text: '正文', workspaceId: WS, sessionId: SE });
  assert.equal(result.added, true);
  assert.equal(result.store.notes.length, 1);
  assert.equal(result.note.workspaceId, WS);
  assert.equal(result.note.sessionId, SE);
});

test('addNote 相同正文幂等：返回已有那条，不新增', () => {
  const first = addNote(emptyStore(), { text: '同样的 正文' });
  const second = addNote(first.store, { text: '同样的正文 ' });
  assert.equal(second.added, false);
  assert.equal(second.store.notes.length, 1);
  assert.equal(second.note.id, first.note.id);
});

test('addNote 拒绝空正文', () => {
  const result = addNote(emptyStore(), { text: '   ' });
  assert.equal(result.note, null);
  assert.equal(result.store.notes.length, 0);
});

test('addNote 把新便签排在最前', () => {
  let store = addNote(emptyStore(), { text: '一' }).store;
  store = addNote(store, { text: '二' }).store;
  assert.deepEqual(store.notes.map((note) => note.text), ['二', '一']);
});

// ── 编辑 ─────────────────────────────────────────────────────────────────────

test('updateNote 改正文并刷新 updatedAt', () => {
  const added = addNote(emptyStore(), { text: '旧' });
  const result = updateNote(added.store, added.note.id, '新正文', '2026-01-02T00:00:00.000Z');
  assert.equal(result.note.text, '新正文');
  assert.equal(result.note.updatedAt, '2026-01-02T00:00:00.000Z');
  assert.equal(result.store.notes[0].text, '新正文');
});

test('updateNote 拒绝空正文与重复正文', () => {
  let store = addNote(emptyStore(), { text: '甲' }).store;
  const second = addNote(store, { text: '乙' });
  store = second.store;
  assert.equal(updateNote(store, second.note.id, '  ').reason, 'empty');
  assert.equal(updateNote(store, second.note.id, '甲').reason, 'duplicate');
  assert.equal(updateNote(store, 'n_missing', '丙').reason, 'missing');
});

test('updateNote 允许把自己改成与自己内容等价的形式', () => {
  const added = addNote(emptyStore(), { text: 'AB' });
  const result = updateNote(added.store, added.note.id, 'a b');
  assert.equal(result.note.text, 'a b');
});

// ── 删除与撤销 ───────────────────────────────────────────────────────────────

test('removeNote 返回被删条目，可按原位置撤销', () => {
  let store = addNote(emptyStore(), { text: '一' }).store;
  store = addNote(store, { text: '二' }).store;
  store = addNote(store, { text: '三' }).store;
  const removed = removeNote(store, store.notes[1].id);
  assert.equal(removed.removed.text, '二');
  assert.equal(removed.store.notes.length, 2);
  const restored = restoreNote(removed.store, removed.removed, 1);
  assert.equal(restored.reason, 'ok');
  assert.equal(restored.restored.text, '二');
  assert.deepEqual(restored.store.notes.map((note) => note.text), ['三', '二', '一']);
});

test('removeNote 找不到 id 时原样返回', () => {
  const store = emptyStore();
  assert.equal(removeNote(store, 'n_none').removed, null);
});

test('restoreNote 不复活与现有正文重复的便签，且说明原因', () => {
  const added = addNote(emptyStore(), { text: '正文' });
  const removed = removeNote(added.store, added.note.id);
  const again = addNote(removed.store, { text: '正文' });
  const restored = restoreNote(again.store, removed.removed, 0);
  // 静默返回原文就是「Toast 弹了已撤销、其实什么都没发生」的根因
  assert.equal(restored.restored, null);
  assert.equal(restored.reason, 'duplicate');
  assert.equal(restored.store.notes.length, 1);
  assert.equal(restored.store.notes[0].id, again.note.id);
});

test('restoreNote 拒绝没有 id 的快照，不会写进 id: undefined', () => {
  const store = emptyStore();
  const outcome = restoreNote(store, { text: '孤儿' }, 0);
  assert.equal(outcome.restored, null);
  assert.equal(outcome.reason, 'missing-id');
  assert.equal(outcome.store.notes.length, 0);
});

test('restoreNote 对已存在的 id 幂等', () => {
  const added = addNote(emptyStore(), { text: '正文' });
  const outcome = restoreNote(added.store, added.note, 0);
  assert.equal(outcome.restored, null);
  assert.equal(outcome.reason, 'id-exists');
  assert.equal(outcome.store.notes.length, 1);
});

test('patchSettings 改回原值时返回同一个 store 引用（host 才能跳过落盘）', () => {
  const store = patchSettings(emptyStore(), { hoverCount: 20 });
  // 同值补丁必须原样返回：否则 host 的 mutate() 每次都判定「有变化」而白写一次磁盘
  assert.equal(patchSettings(store, { hoverCount: 20 }), store);
  // 真的改了才产生新对象
  assert.notEqual(patchSettings(store, { hoverCount: 21 }), store);
});

test('updateNote 保存同一份正文时返回同一个 store 引用', () => {
  const added = addNote(emptyStore(), { text: '正文' });
  const outcome = updateNote(added.store, added.note.id, '正文');
  assert.equal(outcome.store, added.store);
});

// ── 偏好与存储读取 ───────────────────────────────────────────────────────────

test('normalizeSettings 收敛越界值与未知枚举', () => {
  assert.equal(normalizeSettings({ hoverCount: 1 }).hoverCount, 3);
  assert.equal(normalizeSettings({ hoverCount: 999 }).hoverCount, 30);
  assert.equal(normalizeSettings({ hoverCount: 'x' }).hoverCount, HOVER_COUNT_DEFAULT);
  assert.equal(normalizeSettings({ defaultView: 'weird' }).defaultView, 'grouped');
  assert.equal(normalizeSettings({ hoverEnabled: false }).hoverEnabled, false);
});

test('patchSettings 只改给定字段', () => {
  const store = emptyStore();
  const next = patchSettings(store, { hoverCount: 20 });
  assert.equal(next.settings.hoverCount, 20);
  assert.equal(next.settings.hoverEnabled, true);
});

test('normalizeStore 丢弃坏行但保留好行', () => {
  const store = normalizeStore({
    version: 1,
    notes: [
      { id: 'n1', text: '好行', workspaceId: WS, sessionId: SE, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'n2', text: '   ' },
      null,
      { text: '缺 id 也保留' },
    ],
  });
  assert.equal(store.notes.length, 2);
  assert.equal(store.notes[0].id, 'n1');
  assert.ok(store.notes[1].id.startsWith('n_'));
  assert.equal(store.version, 1);
});

test('normalizeStore 对非对象输入返回空存储', () => {
  assert.deepEqual(normalizeStore(null).notes, []);
  assert.deepEqual(normalizeStore('junk').notes, []);
});

test('normalizeText 裁剪超长正文', () => {
  const long = 'x'.repeat(200050);
  assert.equal(normalizeText(long).length, 200000);
});

test('sortedNotes 按 createdAt 倒序且不改原数组', () => {
  const notes = [
    { id: 'a', text: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', text: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortedNotes(notes).map((note) => note.id), ['b', 'a']);
  assert.equal(notes[0].id, 'a');
});

test('findByContent 命中时返回那条便签', () => {
  const added = addNote(emptyStore(), { text: 'Hello World' });
  assert.equal(findByContent(added.store.notes, 'hello  world').id, added.note.id);
});
