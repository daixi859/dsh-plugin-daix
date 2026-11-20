// dsh-prompt-suggest — 纯函数层：meta-prompt 组装、会话事件文本提取、建议清洗。
// 无 DSH 依赖，host 面与测试共用。

/** 会话上下文素材的尾部截断上限（Pendant 同参数）。 */
export const USER_TAIL_CHARS = 2000;
export const ASSISTANT_TAIL_CHARS = 8000;
/** 润色草稿全文上限。 */
export const DRAFT_MAX_CHARS = 4000;
/** 生成模式单条建议的清洗上限（超出视为失败，不给降级文本）。 */
export const SUGGEST_MAX_CHARS = 300;
/** 润色结果的清洗上限。 */
export const POLISH_MAX_CHARS = 4000;
/** 生成一次请求的端到端超时（毫秒）。 */
export const GENERATE_TIMEOUT_MS = 20000;

/**
 * 保留文本末尾至多 max 字符（Pendant 同款尾截；先 trim）。
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
 * 从会话表面事件流中提取最近一轮 user/assistant 文本（倒序扫描，Pendant 同语义）。
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

/** 组装 meta-prompt（固定中文）。mode: 'suggest' | 'polish'。 */
export function buildPrompt(mode, parts) {
  const { draft = '', userText = '', assistantText = '' } = parts;
  const sections = [];

  if (mode === 'polish') {
    sections.push(
      '你是资深开发助手。请润色开发者正在输入的草稿，使其更清晰、具体、适合直接发送给编码代理。',
      [
        '- 保留原意；可以补全意图、修正语病、规范术语。',
        '- 不要添加草稿中没有的新需求；不要回答草稿中提出的问题。',
        '- 直接输出改写后的草稿正文；不要复述或描述任务（不要出现"润色""改写"等字眼），不要前言、引号或解释。',
        '- 使用中文。',
      ].join('\n'),
      `开发者当前输入的草稿：\n${tailText(draft, DRAFT_MAX_CHARS)}`,
    );
  } else {
    sections.push(
      '你正在为一位与编码代理协作的开发者，建议他接下来可能发送的下一条指令。',
      [
        '- 一行，最多 200 个字符。',
        '- 用开发者会直接输入的指令语气书写，不要写成关于开发者的问题。',
        '- 只输出建议本身：不要前言、不要引号、不要解释。',
        '- 使用中文。',
      ].join('\n'),
      `开发者最近发送的消息：\n${tailText(userText, USER_TAIL_CHARS)}`,
      `代理最近的回复：\n${tailText(assistantText, ASSISTANT_TAIL_CHARS)}`,
    );
  }
  return sections.join('\n\n');
}

/**
 * 清洗模型输出。无效时返回 null（上层按失败处理）。
 * - suggest：取第一个非空行，剥包裹引号，超 SUGGEST_MAX_CHARS 判失败；
 *   与 currentDraft（去空格小写比较）相同则视为无变化，返回 null。
 * - polish：保留换行，剥包裹引号，截断到 POLISH_MAX_CHARS。
 * @param {string} raw
 * @param {'suggest'|'polish'} mode
 * @param {string} [currentDraft]
 * @returns {string | null}
 */
export function sanitizeOutput(raw, mode, currentDraft = '') {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.length === 0) return null;
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
  return polished.length > POLISH_MAX_CHARS ? polished.slice(0, POLISH_MAX_CHARS) : polished;
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
