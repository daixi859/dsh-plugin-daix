// dsh-prompt-suggest — 设置（纯函数层）：读写模型的默认路由与思考强度。
// 无 DSH 依赖，host 面与测试共用。
//
// 存的是「这个插件自己用什么模型」，与会话当前模型无关：
// 空值 = 跟随会话，非空 = 固定使用。
// 思考强度同样留空 = 交给模型自己的默认档位。

/** 全部字段为空 = 不覆盖任何东西，与会话保持一致。 */
export const DEFAULT_SETTINGS = Object.freeze({
  provider: '',
  model: '',
  reasoningEffort: '',
});

/**
 * 归一化任意读到的设置。坏值一律回落到默认，绝不抛：
 * 设置文件损坏不该让插件连生成都做不了。
 * @param {unknown} raw
 * @returns {{ provider: string, model: string, reasoningEffort: string }}
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
