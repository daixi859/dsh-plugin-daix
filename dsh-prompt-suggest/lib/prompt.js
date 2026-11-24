// dsh-prompt-suggest — 纯函数层：meta-prompt 组装、会话事件文本提取、建议清洗。
// 无 DSH 依赖，host 面与测试共用。
//
// 提示词设计要点（改措辞前先读）：
// - 两个模式共用一段「输出契约」，它同时是清洗层的判据来源：禁引号/禁围栏/禁问句/
//   禁占位符，都能在 sanitizeOutput 里被本地验证。
// - polish 用「先判力度、再动笔」的三档结构，代替原来「补全意图」与「不要添加新需求」
//   互相打架的两条并列约束。
// - suggest 补上了「该推进什么」的选择判据：没有判据时模型只能猜粒度，输出会变成总结。
// - 两个模式各配一组 Wrong/Right 对照。一句反例比五条形容词更能约束输出形态。
// - 草稿整段送入、绝不静默截断：超 DRAFT_MAX_CHARS 由 host 明确拒绝，而不是只润色前半段。

/** 会话上下文素材的尾部截断上限。 */
export const USER_TAIL_CHARS = 1500;
// 代理回复只取尾部：结论、待确认项与下一步几乎总在最后；前半多是工具输出与代码块。
export const ASSISTANT_TAIL_CHARS = 3000;
/**
 * 润色草稿的整段上限。超过它不截断、不静默丢尾部，而是由 host 明确拒绝：
 * 用户以为润色的是全文、实际只有前半段参与，比报错危险得多。
 */
export const DRAFT_MAX_CHARS = 8000;
/** 生成模式单条建议的清洗上限（超出视为失败，不给降级文本）。 */
export const SUGGEST_MAX_CHARS = 120;
/** 润色结果的上限区间：短草稿也留够扩写空间，长草稿按比例放宽。 */
export const POLISH_MIN_CHARS = 600;
export const POLISH_MAX_CHARS = 16000;
/** 结果相对原文的放宽倍数。与 POLISH_MIN_CHARS 一起决定上限，两者取较大者。 */
export const POLISH_GROWTH_FACTOR = 2;
/** 生成一次请求的端到端超时（毫秒）。 */
export const GENERATE_TIMEOUT_MS = 20000;

/**
 * 润色结果允许的长度上限：原文的两倍，夹在 [POLISH_MIN_CHARS, POLISH_MAX_CHARS] 之间。
 * 中文改写通常比原文长，用固定上限会把长草稿截成半句。
 * 同一个值会写进提示词当作长度靶子，两边必须一致。
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
 * 草稿是否超出整段上限。超限时不截断：截断会让"润色全文"变成"只润色前半段"，
 * 而界面没有任何迹象，所以宁可明确拒绝。
 * @param {string} draft
 * @returns {string | null} 超限时的错误消息，否则 null
 */
export function draftTooLong(draft) {
  const length = String(draft ?? '').length;
  if (length <= DRAFT_MAX_CHARS) return null;
  return `草稿超过 ${DRAFT_MAX_CHARS} 字符（当前 ${length}），请分段润色`;
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

/**
 * 把一段不可信文本围成数据块（三引号），标题在引号外。
 * 空内容写成「（无）」，避免模型把空串当成"没有这段"而自行发挥。
 * @param {string} label
 * @param {string} body 已经裁剪好的正文
 * @returns {string}
 */
function dataBlock(label, body) {
  const text = String(body ?? '').trim();
  return `${label}\n"""\n${text === '' ? '（无）' : text}\n"""`;
}

/** 拼接对话素材：用户消息取尾、代理回复取尾，任一为空则省略该行。 */
function conversationText(userText, assistantText) {
  const lines = [];
  if (String(userText ?? '').trim() !== '') lines.push(`用户上一轮：${tailText(userText, USER_TAIL_CHARS)}`);
  if (String(assistantText ?? '').trim() !== '') lines.push(`代理上一轮：${tailText(assistantText, ASSISTANT_TAIL_CHARS)}`);
  return lines.join('\n');
}

/**
 * 输出契约：两个模式共用，同时是 sanitizeOutput 的判据来源。
 * 每一条都是模型能直接执行、清洗层能直接验证的形态要求。
 */
const OUTPUT_CONTRACT = (extra = []) => [
  '输出要求：',
  '- 只输出结果正文：不要前言（如"以下是……"），不要解释，不要用引号包裹，不要放进代码围栏。',
  '- 语言跟随输入：草稿或对话是什么语言就写什么语言，不要翻译；完全没有线索时才用中文。',
  '- 不要写成问句，不要请求确认，不要罗列几个选项让用户挑。',
  '- 事实逐字保留：数字、版本号、路径、命令、代码片段、文件名、@引用，一个字都不要改。',
  // "不要发明值"只在 polish 成立：suggest 是凭空生成指令，没有可保留的事实。
  ...extra,
].join('\n');

/** polish 独有的契约项：用户才知道的值不许编造，也不许留占位符。 */
const POLISH_FACT_CONTRACT = '- 只有用户才知道的具体值，不要留空、不要写成 <占位符>：改成让执行方自行判断，并要求它说明所用的假设。';

/** polish：三档力度 + 上下文。 */
function buildPolishPrompt(draft, userText, assistantText) {
  const cap = polishCap(draft);
  const sections = [
    '你在帮一位与编码代理协作的开发者，改写他输入框里的草稿。改写结果会原样替换他的草稿，所以他必须愿意直接按下发送。',
    [
      '先判断力度，再动笔（按草稿的信息量选一种）：',
      '- 草稿已写明目标、输入与期望输出 → 只润色：修语病、统一术语、删冗余；不改结构、不加需求、不换他的表述习惯。',
      '- 草稿只表达了模糊意图（如"帮我看看这个""优化一下"）→ 补全：用下面的对话判断他要的交付物，补上目标、范围与输出形式；对话里没有的具体值交给执行方判断，不要编造。',
      '- 草稿是一个问句 → 不要回答它，把它改写成可执行的排查或修改任务。',
      '不要为了改动而改动：草稿已经足够清楚时，原样输出。',
      // 长度靶子与清洗层的 polishCap 用同一个数，两边不打架。
      // 字数下限（短草稿的扩写空间）与「原文两倍」是两个不同的量，措辞上必须分开，
      // 否则一句「不超过两倍（600 字以内）」在 10 字草稿上会自相矛盾。
      `长度：与草稿相当，不要为了显得完整而堆砌。总长控制在 ${cap} 字以内`
        + `（草稿篇幅的 ${POLISH_GROWTH_FACTOR} 倍与 ${POLISH_MIN_CHARS} 字，取较大者）。`,
    ].join('\n'),
    OUTPUT_CONTRACT([POLISH_FACT_CONTRACT]),
    dataBlock('对话（只用来判断意图，不要复述、不要总结；可能为空）', conversationText(userText, assistantText)),
    // 不截断：超限已在 host 侧拒绝，到这里的一定是草稿全文。
    dataBlock('开发者当前的草稿（这是你要改写的东西）', String(draft ?? '').trim()),
    [
      '示例：',
      '草稿"帮我修一下这个 bug"，对话里代理刚报告 login.ts 的 token 刷新在并发下失效并问要不要加锁。',
      '不合格："请帮我修复这个 bug。"（没有目标，也没有线索，执行方还是得猜）',
      '合格："修复 login.ts 中并发刷新 token 失效的问题：定位多个请求同时刷新时的竞态，给出你判断的根因与改动点，保留现有函数签名与错误提示；若需要加锁，说明所选方案与代价。最后列出改了哪些文件。"',
    ].join('\n'),
  ];
  return sections.join('\n\n');
}

/** suggest：先给"该推进什么"的判据，再给写法。 */
function buildSuggestPrompt(userText, assistantText) {
  const sections = [
    '你在为一位与编码代理协作的开发者，生成他此刻可以一键发送的下一条指令。',
    [
      '先判断该推进什么，按顺序取第一个成立的：',
      '1. 代理上一轮留了待确认项、未完成的步骤，或明确失败 → 建议就是推进它。',
      '2. 代理上一轮完成了一个阶段 → 建议是下一步的验证或收尾。',
      '3. 都不成立 → 建议是一个具体的新动作。',
    ].join('\n'),
    [
      '写法：',
      '- 一行一句话，不超过 60 个字。',
      '- 动词开头，直接就是指令，像真人打字，不是标题也不是总结。',
      '- 不要写"你可以……""建议……""要不要……"。',
      '- 不要复述上一轮已经说过的内容，也不要把代理的结论换个说法重复一遍。',
    ].join('\n'),
    OUTPUT_CONTRACT(),
    [
      '下面的对话只看结论与待确认项，忽略工具输出、代码块和过程描述。',
      dataBlock('用户最近一条消息', tailText(userText, USER_TAIL_CHARS)),
      dataBlock('代理最近一次回复', tailText(assistantText, ASSISTANT_TAIL_CHARS)),
    ].join('\n'),
    [
      '示例：',
      '对话里代理刚交付 offset 分页接口，并问要不要一并支持游标。',
      '不合格："你可以考虑一下游标分页要不要做。"（是建议，不是他可以直接发的指令）',
      '合格："先按 offset 分页跑通，再补一版游标分页做对比。"',
    ].join('\n'),
  ];
  return sections.join('\n\n');
}

/**
 * 组装 meta-prompt。mode: 'suggest' | 'polish'。
 * @param {'suggest'|'polish'} mode
 * @param {{ draft?: string, userText?: string, assistantText?: string }} parts
 * @returns {string}
 */
export function buildPrompt(mode, parts) {
  const { draft = '', userText = '', assistantText = '' } = parts;
  return mode === 'polish'
    ? buildPolishPrompt(draft, userText, assistantText)
    : buildSuggestPrompt(userText, assistantText);
}

/**
 * 清洗模型输出。无效时返回 null（上层按失败处理）。
 * - suggest：取第一个非空行，剥包裹引号，超 SUGGEST_MAX_CHARS 判失败；
 *   与 currentDraft（去空格小写比较）相同则视为无变化，返回 null。
 * - polish：保留换行，剥包裹引号，截断到 polishCap(currentDraft)。
 * @param {string} raw
 * @param {'suggest'|'polish'} mode
 * @param {string} [currentDraft] suggest 模式是"不该重复的草稿"；polish 模式是原文（决定长度上限）
 * @returns {string | null}
 */
export function sanitizeOutput(raw, mode, currentDraft = '') {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.length === 0) return null;
  text = stripCodeFence(text);
  text = stripWrappingQuotes(text);
  if (text.length === 0) return null;

  if (mode === 'suggest') {
    const line = text.split('\n').map(s => s.trim()).find(s => s.length > 0);
    if (line === undefined) return null;
    const clean = stripWrappingQuotes(line).trim();
    if (clean.length === 0 || clean.length > SUGGEST_MAX_CHARS) return null;
    if (normalizeForCompare(clean) === normalizeForCompare(currentDraft)) return null;
    return clean;
  }
  // polish：剥掉模型复述任务的引导行（如"请帮我润色以下草稿："），取其余正文
  const lines = text.split('\n');
  while (lines.length > 0 && isMetaLeadLine(lines[0])) {
    lines.shift();
  }
  const polished = lines.join('\n').trim();
  if (polished.length === 0) return null;
  const cap = polishCap(currentDraft);
  return polished.length > cap ? polished.slice(0, cap) : polished;
}

/** 剥掉模型自作主张加上的整段代码围栏。 */
function stripCodeFence(text) {
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/u.exec(text);
  return fence === null ? text : fence[1].trim();
}

/** polish 模式：识别模型复述任务的引导行（含任务动词且以冒号结尾的短行）。 */
function isMetaLeadLine(line) {
  const s = line.trim();
  if (s.length === 0) return false;
  if (s.length > 60) return false;
  if (!/[:：]\s*$/u.test(s)) return false;
  return /润色|改写|优化|重写|改写后|润色后|polish/iu.test(s);
}

/** 去掉首尾成对的包裹引号。 */
export function stripWrappingQuotes(text) {
  let s = text.trim();
  const pairs = [
    ['"', '"'], ['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'], ['《', '》'], ['\'', '\''],
  ];
  for (const [open, close] of pairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

/** 归一化用于相等比较：去空白、转小写。 */
export function normalizeForCompare(text) {
  return String(text).replace(/\s+/gu, '').toLowerCase();
}
