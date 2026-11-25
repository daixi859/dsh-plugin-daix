// lib/settings.js 纯函数测试。运行：node --test dsh-prompt-suggest/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  isValidLimit,
  listReasoningEfforts,
  mergeSettings,
  normalizeSettings,
  pickReasoningEffort,
  validateSettingsPatch,
} from '../lib/settings.js';
import { DEFAULT_TEMPLATES, DRAFT_MAX_CHARS, LIMIT_MAX_CHARS, TEMPLATE_MAX_CHARS } from '../lib/prompt.js';

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
  assert.equal(paired.provider, 'deepseek');
  assert.equal(paired.model, 'deepseek-chat');
});

test('normalizeSettings 保留 reasoningEffort', () => {
  assert.equal(normalizeSettings({ reasoningEffort: 'off' }).reasoningEffort, 'off');
});

test('normalizeSettings 空白模板视为未设置，非空模板原样保留', () => {
  assert.equal(normalizeSettings({ suggestPrompt: '   ' }).suggestPrompt, '');
  const custom = '  自定义\n{{userText}}  ';
  assert.equal(normalizeSettings({ suggestPrompt: custom }).suggestPrompt, custom);
});

test('normalizeSettings 非法上限回落到默认', () => {
  assert.equal(normalizeSettings({ draftMaxChars: 'x' }).draftMaxChars, DRAFT_MAX_CHARS);
  assert.equal(normalizeSettings({ draftMaxChars: 0 }).draftMaxChars, DRAFT_MAX_CHARS);
  assert.equal(normalizeSettings({ draftMaxChars: LIMIT_MAX_CHARS + 1 }).draftMaxChars, DRAFT_MAX_CHARS);
  assert.equal(normalizeSettings({ templateMaxChars: 12.5 }).templateMaxChars, TEMPLATE_MAX_CHARS);
});

// ── isValidLimit ─────────────────────────────────────────────────────────────

test('isValidLimit 只接受 1 到 LIMIT_MAX_CHARS 的整数，下限不设约束', () => {
  assert.equal(isValidLimit(1), true);
  assert.equal(isValidLimit(LIMIT_MAX_CHARS), true);
  assert.equal(isValidLimit(0), false);
  assert.equal(isValidLimit(-5), false);
  assert.equal(isValidLimit(LIMIT_MAX_CHARS + 1), false);
  assert.equal(isValidLimit(100.5), false);
  assert.equal(isValidLimit('1000'), false);
});

// ── mergeSettings ────────────────────────────────────────────────────────────

test('mergeSettings 只覆盖补丁里出现的字段', () => {
  const base = { ...DEFAULT_SETTINGS, provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' };
  const merged = mergeSettings(base, { reasoningEffort: 'off' });
  assert.equal(merged.provider, 'deepseek');
  assert.equal(merged.reasoningEffort, 'off');
});

test('mergeSettings 忽略未知字段', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { provider: 'p', model: 'm', evil: 'x' });
  assert.equal(Object.hasOwn(merged, 'evil'), false);
  assert.equal(merged.provider, 'p');
});

test('mergeSettings 清空 provider 时 model 一并清空', () => {
  const base = { ...DEFAULT_SETTINGS, provider: 'p', model: 'm' };
  const merged = mergeSettings(base, { provider: '' });
  assert.equal(merged.provider, '');
  assert.equal(merged.model, '');
});

test('mergeSettings 恢复默认：清空模板字段', () => {
  const base = { ...DEFAULT_SETTINGS, suggestPrompt: '自定义 {{userText}} {{assistantText}}' };
  assert.equal(mergeSettings(base, { suggestPrompt: '' }).suggestPrompt, '');
});

// ── validateSettingsPatch ────────────────────────────────────────────────────

test('validateSettingsPatch 拒绝超出范围的上限，且不静默回落', () => {
  assert.match(validateSettingsPatch({ draftMaxChars: 0 }, DEFAULT_SETTINGS), /草稿上限/);
  assert.match(validateSettingsPatch({ templateMaxChars: LIMIT_MAX_CHARS + 1 }, DEFAULT_SETTINGS), /模板上限/);
});

test('validateSettingsPatch 接受 1 与上限本身（不设下限）', () => {
  assert.equal(validateSettingsPatch({ draftMaxChars: 1 }, DEFAULT_SETTINGS), null);
  assert.equal(validateSettingsPatch({ draftMaxChars: LIMIT_MAX_CHARS }, DEFAULT_SETTINGS), null);
});

test('validateSettingsPatch 拒绝不合法的模板', () => {
  assert.match(validateSettingsPatch({ polishPrompt: '没有占位符' }, DEFAULT_SETTINGS), /缺少必需的占位符/);
  assert.match(validateSettingsPatch({ suggestPrompt: 123 }, DEFAULT_SETTINGS), /必须是字符串/);
});

test('validateSettingsPatch 合法模板与上限通过', () => {
  const ok = { suggestPrompt: DEFAULT_TEMPLATES.suggest, polishPrompt: DEFAULT_TEMPLATES.polish };
  assert.equal(validateSettingsPatch(ok, DEFAULT_SETTINGS), null);
});

test('validateSettingsPatch 模板长度按合并后的模板上限判断', () => {
  const long = DEFAULT_TEMPLATES.suggest;
  assert.match(validateSettingsPatch({ suggestPrompt: long, templateMaxChars: 100 }, DEFAULT_SETTINGS), /超过 100/);
  const raised = { ...DEFAULT_SETTINGS, templateMaxChars: 20000 };
  assert.equal(validateSettingsPatch({ suggestPrompt: long }, raised), null);
});

test('validateSettingsPatch 无关改动不被已保存的旧模板拦住', () => {
  const current = { ...DEFAULT_SETTINGS, suggestPrompt: '损坏的旧模板' };
  assert.equal(validateSettingsPatch({ reasoningEffort: 'off' }, current), null);
});

// ── pickReasoningEffort ──────────────────────────────────────────────────────

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
