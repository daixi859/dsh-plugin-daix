// dsh-prompt-suggest — 设置（纯函数层）：模型路由、思考强度、提示词模板与长度上限。
// 无 DSH 依赖，host 面与测试共用。
//
// 存的是「这个插件自己用什么」，与会话当前模型无关：
// 路由空值 = 跟随会话，非空 = 固定使用；思考强度留空 = 模型默认；
// 模板留空 = 内置默认；上限是正整数，不超过 LIMIT_MAX_CHARS（下限不设约束）。

import {
  DRAFT_MAX_CHARS,
  LIMIT_MAX_CHARS,
  TEMPLATE_MAX_CHARS,
  validateTemplate,
} from './prompt.js';

/** 全部字段为空/默认 = 不覆盖任何东西，与会话保持一致。 */
export const DEFAULT_SETTINGS = Object.freeze({
  provider: '',
  model: '',
  reasoningEffort: '',
  suggestPrompt: '',
  polishPrompt: '',
  draftMaxChars: DRAFT_MAX_CHARS,
  templateMaxChars: TEMPLATE_MAX_CHARS,
});

const LIMIT_LABEL = Object.freeze({ draftMaxChars: '草稿上限', templateMaxChars: '模板上限' });
const TEMPLATE_KEYS = Object.freeze(['suggestPrompt', 'polishPrompt']);
const TEMPLATE_MODE = Object.freeze({ suggestPrompt: 'suggest', polishPrompt: 'polish' });

/** 合法上限：正整数且不超过 LIMIT_MAX_CHARS。 */
export function isValidLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= LIMIT_MAX_CHARS;
}

/** 模板：空白视为未设置（空串）；非空时原样保存，不修改用户的空白排版。 */
function templateText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}

/**
 * 归一化任意读到的设置。坏值一律回落到默认，绝不抛：
 * 设置文件损坏不该让插件连生成都做不了。
 * @param {unknown} raw
 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const provider = text(source.provider);
  const model = text(source.model);
  // provider 与 model 必须成对：只有一个时不构成一段可用的路由。
  const paired = provider !== '' && model !== '';
  return {
    provider: paired ? provider : '',
    model: paired ? model : '',
    reasoningEffort: text(source.reasoningEffort),
    suggestPrompt: templateText(source.suggestPrompt),
    polishPrompt: templateText(source.polishPrompt),
    draftMaxChars: isValidLimit(source.draftMaxChars) ? source.draftMaxChars : DRAFT_MAX_CHARS,
    templateMaxChars: isValidLimit(source.templateMaxChars) ? source.templateMaxChars : TEMPLATE_MAX_CHARS,
  };
}

/**
 * 合并一次补丁。patch 里出现未知字段会被忽略，不会写进文件。
 * @param {unknown} current
 * @param {unknown} patch
 */
export function mergeSettings(current, patch) {
  const merged = { ...normalizeSettings(current) };
  const next = patch !== null && typeof patch === 'object' ? patch : {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (next[key] === undefined) continue;
    merged[key] = next[key];
  }
  return normalizeSettings(merged);
}

/**
 * 校验一次写入补丁（在合并之后校验，因为模板长度取决于合并后的模板上限）。
 * 返回错误消息或 null。非法值直接拒绝，不静默回落。
 * @param {unknown} patch
 * @param {unknown} current 当前已保存的设置
 * @returns {string | null}
 */
export function validateSettingsPatch(patch, current) {
  const next = patch !== null && typeof patch === 'object' ? patch : {};
  for (const key of Object.keys(LIMIT_LABEL)) {
    if (next[key] !== undefined && !isValidLimit(next[key])) {
      return `${LIMIT_LABEL[key]}须为 1–${LIMIT_MAX_CHARS} 之间的整数`;
    }
  }
  for (const key of TEMPLATE_KEYS) {
    if (next[key] !== undefined && typeof next[key] !== 'string') return '提示词模板必须是字符串';
  }
  const merged = mergeSettings(current, patch);
  // 只在本次补丁触及模板或模板上限时校验模板，避免无关改动被旧模板拦住。
  const touchesTemplates = next.templateMaxChars !== undefined || TEMPLATE_KEYS.some((key) => next[key] !== undefined);
  if (!touchesTemplates) return null;
  for (const key of TEMPLATE_KEYS) {
    if (merged[key] === '') continue;
    const message = validateTemplate(TEMPLATE_MODE[key], merged[key], merged.templateMaxChars);
    if (message !== null) return message;
  }
  return null;
}

/**
 * 从模型声明的思考档位里挑一个实际可用的。
 *
 * prepareCall 对不支持的档位会直接抛 UNSUPPORTED_REASONING_EFFORT；
 * 模型没有 reasoning 能力时，传任何值同样会抛。所以这里只返回两件事：
 * 命中的档位，或 undefined（= 什么都不传，用模型自己的默认）。
 *
 * @param {unknown} info resolveModelInfo 的返回（可能为空）
 * @param {string} requested 用户选择的档位
 * @returns {string | undefined}
 */
export function pickReasoningEffort(info, requested) {
  const wanted = typeof requested === 'string' ? requested.trim() : '';
  if (wanted === '') return undefined;
  const efforts = info !== null && typeof info === 'object' ? info.reasoning?.efforts : undefined;
  if (!Array.isArray(efforts)) return undefined;
  const hit = efforts.find((effort) => effort !== null && typeof effort === 'object' && effort.id === wanted);
  return hit === undefined ? undefined : wanted;
}

/**
 * 模型声明的可选思考档位，供设置页渲染下拉。
 * 没有推理能力的模型返回空数组（界面据此显示「该模型不支持」）。
 * @param {unknown} info
 * @returns {Array<{ id: string, name: string }>}
 */
export function listReasoningEfforts(info) {
  const efforts = info !== null && typeof info === 'object' ? info.reasoning?.efforts : undefined;
  if (!Array.isArray(efforts)) return [];
  return efforts
    .filter((effort) => effort !== null && typeof effort === 'object' && typeof effort.id === 'string' && effort.id !== '')
    .map((effort) => ({ id: effort.id, name: typeof effort.name === 'string' && effort.name !== '' ? effort.name : effort.id }));
}
