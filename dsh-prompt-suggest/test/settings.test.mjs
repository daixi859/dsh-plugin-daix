// lib/settings.js 纯函数测试。运行：node --test dsh-prompt-suggest/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  listReasoningEfforts,
  mergeSettings,
  normalizeSettings,
  pickReasoningEffort,
} from '../lib/settings.js';

// ── normalizeSettings ────────────────────────────────────────────────────────

test('normalizeSettings 空/坏值回落到默认', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ provider: 1, model: {}, reasoningEffort: [] }), DEFAULT_SETTINGS);
});

test('normalizeSettings provider/model 必须成对', () => {
  assert.equal(normalizeSettings({ provider: 'deepseek' }).provider, '');
  assert.equal(normalizeSettings({ model: 'deepseek-chat' }).model, '');
  const paired = normalizeSettings({ provider: ' deepseek ', model: ' deepseek-chat ' });
  assert.deepEqual(paired, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: '' });
});

test('normalizeSettings 保留 reasoningEffort', () => {
  assert.equal(normalizeSettings({ reasoningEffort: 'off' }).reasoningEffort, 'off');
});

// ── mergeSettings ────────────────────────────────────────────────────────────

test('mergeSettings 只覆盖补丁里出现的字段', () => {
  const base = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' };
  assert.deepEqual(mergeSettings(base, { reasoningEffort: 'off' }), {
    provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'off',
  });
});

test('mergeSettings 忽略未知字段', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { provider: 'p', model: 'm', evil: 'x' });
  assert.equal(Object.hasOwn(merged, 'evil'), false);
  assert.equal(merged.provider, 'p');
});

test('mergeSettings 清空 provider 时 model 一并清空', () => {
  const base = { provider: 'p', model: 'm', reasoningEffort: '' };
  assert.deepEqual(mergeSettings(base, { provider: '' }), { ...DEFAULT_SETTINGS });
});

// ── pickReasoningEffort ──────────────────────────────────────────────────────

// 模型元数据的固定 fixture：模拟一个公布 off/low/high 三档、没有 max 的模型。
const reasoningInfo = { reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } };

test('pickReasoningEffort 命中模型公布的档位', () => {
  assert.equal(pickReasoningEffort(reasoningInfo, 'off'), 'off');
  assert.equal(pickReasoningEffort(reasoningInfo, 'high'), 'high');
});

test('pickReasoningEffort 未公布的档位返回 undefined（交给模型默认）', () => {
  assert.equal(pickReasoningEffort(reasoningInfo, 'max'), undefined);
});

test('pickReasoningEffort 模型没有推理能力时一律 undefined', () => {
  assert.equal(pickReasoningEffort({}, 'off'), undefined);
  assert.equal(pickReasoningEffort(undefined, 'off'), undefined);
  assert.equal(pickReasoningEffort({ reasoning: { efforts: [] } }, 'off'), undefined);
});

test('pickReasoningEffort 空选择返回 undefined', () => {
  assert.equal(pickReasoningEffort(reasoningInfo, ''), undefined);
  assert.equal(pickReasoningEffort(reasoningInfo, undefined), undefined);
});

// ── listReasoningEfforts ─────────────────────────────────────────────────────

test('listReasoningEfforts 输出 id/name 供下拉使用', () => {
  assert.deepEqual(listReasoningEfforts(reasoningInfo), [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ]);
});

test('listReasoningEfforts 无推理能力时返回空数组', () => {
  assert.deepEqual(listReasoningEfforts({}), []);
  assert.deepEqual(listReasoningEfforts(null), []);
});

test('listReasoningEfforts 跳过 id 非法的条目', () => {
  const messy = { reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: '', name: 'x' }, { name: 'y' }] } };
  assert.deepEqual(listReasoningEfforts(messy), [{ id: 'off', name: 'Off' }]);
});
