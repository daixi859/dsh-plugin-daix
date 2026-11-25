// dsh-prompt-suggest — 纯函数层：提示词模板（占位符渲染与校验）、会话事件文本提取。
// 无 DSH 依赖，host 面与测试共用。
//
// 提示词是模板：整段 meta-prompt（含输出规则与数据块）都可在设置页修改，
// 素材通过 {{name}} 占位符注入。模型返回什么就原样使用，不做清洗；
// 唯一的输出校验是「空输出报错」，由 host 面负责。

/** 会话上下文素材的尾部截断上限。 */
export const USER_TAIL_CHARS = 1500;
// 代理回复只取尾部：结论、待确认项与下一步几乎总在最后；前半多是工具输出与代码块。
export const ASSISTANT_TAIL_CHARS = 3000;
/** 草稿长度上限的默认值（设置页可改）。超限明确拒绝，不截断。 */
export const DRAFT_MAX_CHARS = 8000;
/** 自定义模板长度上限的默认值（设置页可改）。 */
export const TEMPLATE_MAX_CHARS = 8000;
/** 草稿与模板长度上限共用的硬上限。下限不设约束，只要求正整数。 */
export const LIMIT_MAX_CHARS = 32000;
/** 润色结果的长度靶子（只写进提示词，不据此截断结果）：原文两倍与下限取较大者，再夹在上限内。 */
export const POLISH_MIN_CHARS = 600;
export const POLISH_MAX_CHARS = 16000;
export const POLISH_GROWTH_FACTOR = 2;
/** 生成一次请求的端到端超时（毫秒）。 */
export const GENERATE_TIMEOUT_MS = 20000;

/** 每个模式必需的占位符；也是该模式允许出现的全部占位符。 */
export const PLACEHOLDERS = Object.freeze({
  suggest: Object.freeze(['userText', 'assistantText']),
  polish: Object.freeze(['draft', 'userText', 'assistantText', 'polishCap']),
});

/** 输出规则：两个模式共用。模型返回什么就原样使用，所以这几条是唯一的形态约束。 */
const OUTPUT_RULES = [
  '输出要求：',
  '- 只输出结果正文：不要前言（如"以下是……"），不要解释，不要用引号包裹，不要放进代码围栏。',
  '- 语言跟随输入：草稿或对话是什么语言就写什么语言，不要翻译；完全没有线索时才用中文。',
  '- 不要写成问句，不要请求确认，不要罗列几个选项让用户挑。',
  '- 事实逐字保留：数字、版本号、路径、命令、代码片段、文件名、@引用，一个字都不要改。',
];

/** 内置 suggest 模板。占位符 {{userText}}、{{assistantText}} 必须保留。 */
const SUGGEST_TEMPLATE = [
  '你在为一位与编码代理协作的开发者，生成他此刻可以一键发送的下一条指令。',
  '',
  '先判断该推进什么，按顺序取第一个成立的：',
  '1. 代理上一轮留了待确认项、未完成的步骤，或明确失败 → 建议就是推进它。',
  '2. 代理上一轮完成了一个阶段 → 建议是下一步的验证或收尾。',
  '3. 都不成立 → 建议是一个具体的新动作。',
  '',
  '写法：',
  '- 一行一句话，不超过 60 个字。',
  '- 动词开头，直接就是指令，像真人打字，不是标题也不是总结。',
  '- 不要写"你可以……""建议……""要不要……"。',
  '- 不要复述上一轮已经说过的内容，也不要把代理的结论换个说法重复一遍。',
  '',
  ...OUTPUT_RULES,
  '',
  '下面的对话只看结论与待确认项，忽略工具输出、代码块和过程描述。',
  '用户最近一条消息：',
  '"""',
  '{{userText}}',
  '"""',
  '代理最近一次回复：',
  '"""',
  '{{assistantText}}',
  '"""',
  '',
  '示例：',
  '对话里代理刚交付 offset 分页接口，并问要不要一并支持游标。',
  '不合格："你可以考虑一下游标分页要不要做。"（是建议，不是他可以直接发的指令）',
  '合格："先按 offset 分页跑通，再补一版游标分页做对比。"',
].join('\n');

/** 内置 polish 模板。占位符 {{draft}}、{{userText}}、{{assistantText}}、{{polishCap}} 必须保留。 */
const POLISH_TEMPLATE = [
  '你在帮一位与编码代理协作的开发者，改写他输入框里的草稿。改写结果会原样替换他的草稿，所以他必须愿意直接按下发送。',
  '',
  '先判断力度，再动笔（按草稿的信息量选一种）：',
  '- 草稿已写明目标、输入与期望输出 → 只润色：修语病、统一术语、删冗余；不改结构、不加需求、不换他的表述习惯。',
  '- 草稿只表达了模糊意图（如"帮我看看这个""优化一下"）→ 补全：用下面的对话判断他要的交付物，补上目标、范围与输出形式；对话里没有的具体值交给执行方判断，不要编造。',
  '- 草稿是一个问句 → 不要回答它，把它改写成可执行的排查或修改任务。',
  '不要为了改动而改动：草稿已经足够清楚时，原样输出。',
  '长度：与草稿相当，不要为了显得完整而堆砌。总长控制在 {{polishCap}} 字以内（草稿篇幅的 2 倍与 600 字，取较大者）。',
  '',
  ...OUTPUT_RULES,
  '- 只有用户才知道的具体值，不要留空、不要写成 <占位符>：改成让执行方自行判断，并要求它说明所用的假设。',
  '',
  '下面的对话只用来判断意图，不要复述、不要总结；可能为空。',
  '用户上一轮：',
  '"""',
  '{{userText}}',
  '"""',
  '代理上一轮：',
  '"""',
  '{{assistantText}}',
  '"""',
  '',
  '开发者当前的草稿（这是你要改写的东西）：',
  '"""',
  '{{draft}}',
  '"""',
  '',
  '示例：',
  '草稿"帮我修一下这个 bug"，对话里代理刚报告 login.ts 的 token 刷新在并发下失效并问要不要加锁。',
  '不合格："请帮我修复这个 bug。"（没有目标，也没有线索，执行方还是得猜）',
  '合格："修复 login.ts 中并发刷新 token 失效的问题：定位多个请求同时刷新时的竞态，给出你判断的根因与改动点，保留现有函数签名与错误提示；若需要加锁，说明所选方案与代价。最后列出改了哪些文件。"',
].join('\n');

/** 内置模板：设置页的「恢复默认」与未自定义时使用。 */
export const DEFAULT_TEMPLATES = Object.freeze({
  suggest: SUGGEST_TEMPLATE,
  polish: POLISH_TEMPLATE,
});

/** 设置页样例素材：预览与试跑使用，不落盘。 */
export const SAMPLES = Object.freeze({
  draft: '帮我修一下这个 bug',
  userText: '登录一直超时，最近两天才开始的。',
  assistantText: '定位到 login.ts 的 token 刷新在并发请求下失效：多个请求同时发现 token 过期，各自刷新一次，后刷新的会覆盖前一个。我还没改代码，想先确认：要不要在刷新处加锁？',
});

/**
 * 润色结果的长度靶子：原文两倍与 POLISH_MIN_CHARS 取较大者，夹在 POLISH_MAX_CHARS 之内。
 * 只用于 {{polishCap}} 占位符的数字，host 不据此截断结果。
 * @param {string} draft
 * @returns {number}
 */
export function polishCap(draft) {
  const length = String(draft ?? '').length;
  return Math.min(POLISH_MAX_CHARS, Math.max(POLISH_MIN_CHARS, length * POLISH_GROWTH_FACTOR));
}

/**
 * 保留文本末尾至多 max 字符（先 trim）。
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function tailText(text, max) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(-max);
}

/**
 * 草稿是否超出上限。超限时不截断：截断会让"润色全文"变成"只润色前半段"，
 * 而界面没有任何迹象，所以宁可明确拒绝。
 * @param {string} draft
 * @param {number} [max] 草稿上限，默认 DRAFT_MAX_CHARS；实际值来自设置
 * @returns {string | null} 超限时的错误消息，否则 null
 */
export function draftTooLong(draft, max = DRAFT_MAX_CHARS) {
  const length = String(draft ?? '').length;
  if (length <= max) return null;
  return `草稿超过 ${max} 字符（当前 ${length}），请分段润色，或在设置页调高草稿上限`;
}

/**
 * 从会话表面事件流中提取最近一轮 user/assistant 文本（倒序扫描）。
 * - user/message 且 data.source.kind === 'user' 才算用户消息；
 * - assistant/message 取 data.message.content 的文本块拼接；
 * - 找不到 assistant 消息时返回 { userText: '', assistantText: '' }（上层拒绝生成）。
 * @param {readonly unknown[]} events 按 model-history 顺序的表面事件
 * @returns {{ userText: string, assistantText: string }}
 */
export function extractLastTurnText(events) {
  let userText = '';
  let assistantText = '';
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const type = event && typeof event === 'object' ? event.type : undefined;
    if (type === 'user/message' && userText === '') {
      const data = event.data;
      if (data && data.source && data.source.kind === 'user') {
        userText = blocksText(data.content);
      }
    } else if (type === 'assistant/message' && assistantText === '') {
      const message = event.data && event.data.message;
      if (message) assistantText = blocksText(message.content);
    }
    if (userText !== '' && assistantText !== '') break;
  }
  return { userText, assistantText };
}

/** 拼接 ContentBlock 数组的文本块（\n 连接）。 */
export function blocksText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/gu;

/**
 * 模板里出现的占位符名（按出现顺序，可重复）。
 * @param {string} template
 * @returns {string[]}
 */
export function placeholdersIn(template) {
  return Array.from(String(template ?? '').matchAll(PLACEHOLDER_RE), (match) => match[1]);
}

/**
 * 单次扫描替换占位符。素材里出现的 {{x}} 不会被再次展开。
 * 未知名字原样保留（保存时已拒绝，这里只是兜底）。
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function renderTemplate(template, values) {
  return String(template).replace(PLACEHOLDER_RE, (whole, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
  ));
}

const placeholderList = (names) => names.map((name) => '{{' + name + '}}').join('、');

/**
 * 校验模板。返回错误消息或 null。
 * 规则：非空、不超过长度上限、只用该模式允许的占位符、必需占位符齐全、没有写坏的 {{。
 * @param {'suggest'|'polish'} mode
 * @param {string} template
 * @param {number} [maxChars] 模板上限，默认 TEMPLATE_MAX_CHARS；实际值来自设置
 * @returns {string | null}
 */
export function validateTemplate(mode, template, maxChars = TEMPLATE_MAX_CHARS) {
  const allowed = PLACEHOLDERS[mode];
  if (allowed === undefined) return `未知模式：${mode}`;
  const text = String(template ?? '');
  if (text.trim() === '') return '提示词不能为空；要恢复内置提示词，请点"恢复默认"';
  if (text.length > maxChars) return `提示词超过 ${maxChars} 字符（当前 ${text.length}），请精简或在设置页调高模板上限`;
  const used = new Set(placeholdersIn(text));
  const unknown = [...used].filter((name) => !allowed.includes(name));
  if (unknown.length > 0) return `包含未知占位符：${placeholderList(unknown)}`;
  if (text.replace(PLACEHOLDER_RE, '').includes('{{')) return '存在格式不对的占位符，应写成 {{name}}（花括号内不要有空格）';
  const missing = allowed.filter((name) => !used.has(name));
  if (missing.length > 0) return `缺少必需的占位符：${placeholderList(missing)}`;
  return null;
}

/** 上下文素材为空时写成「（无）」，避免模型把空白当成"没有这段"而自行发挥。 */
function contextBlock(text, max) {
  const tail = tailText(text, max);
  return tail === '' ? '（无）' : tail;
}

/**
 * 用模板组装 meta-prompt。template 缺省或为空白时使用内置默认。
 * 占位符取值：draft 为 trim 后的草稿；userText/assistantText 为尾截断后的素材；polishCap 为数字。
 * @param {'suggest'|'polish'} mode
 * @param {string | undefined} template
 * @param {{ draft?: string, userText?: string, assistantText?: string }} [parts]
 * @returns {string}
 */
export function buildPrompt(mode, template, parts = {}) {
  const { draft = '', userText = '', assistantText = '' } = parts;
  const source = typeof template === 'string' && template.trim() !== '' ? template : DEFAULT_TEMPLATES[mode];
  return renderTemplate(source, {
    draft: String(draft ?? '').trim(),
    userText: contextBlock(userText, USER_TAIL_CHARS),
    assistantText: contextBlock(assistantText, ASSISTANT_TAIL_CHARS),
    polishCap: String(polishCap(draft)),
  });
}
