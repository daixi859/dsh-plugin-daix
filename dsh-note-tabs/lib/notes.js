// dsh-note-tabs — host 面纯逻辑（存储形状 + 去重 + 增删改）
//
// 职责边界：这一层不碰文件系统、不碰 Cordis，只做纯函数，便于 node --test。
// 便签只存回答 Markdown 原文；工作区/会话只存 id，展示时现查（Q15/Q21）。
// 去重按正文内容哈希（去空白 + 小写），不存 messageId（Q22）。

/** 存储版本；字段或语义变化时递增。 */
export const STORE_VERSION = 1;

/** 单条便签正文上限（字符）。超长回答按上限截断后收藏。 */
export const MAX_TEXT_CHARS = 200000;

/** 便签条数上限；state 每次返回整份存储，无上限会让响应随时间线性膨胀。 */
export const MAX_NOTES = 1000;

/** 悬浮框条数范围与默认值（Q12）。 */
export const HOVER_COUNT_MIN = 3;
export const HOVER_COUNT_MAX = 30;
export const HOVER_COUNT_DEFAULT = 10;

/** 默认视图：按工作区分组 / 全部平铺。 */
export const DEFAULT_VIEW = 'grouped';

/** 空存储。 */
export function emptyStore() {
  return {
    version: STORE_VERSION,
    notes: [],
    settings: defaultSettings(),
  };
}

/** 三项偏好的默认值。 */
export function defaultSettings() {
  return {
    hoverCount: HOVER_COUNT_DEFAULT,
    hoverEnabled: true,
    defaultView: DEFAULT_VIEW,
  };
}

/**
 * 正文内容键：去空白、小写。
 * @param {unknown} text 正文
 * @returns {string}
 */
export function contentKey(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, '').toLowerCase() : '';
}

/** 校验并裁剪正文；空正文返回 null。 */
export function normalizeText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS) : trimmed;
}

/** 生成不与现有 id 冲突的便签 id。 */
export function nextId(notes) {
  const taken = new Set((Array.isArray(notes) ? notes : []).map((note) => note && note.id));
  for (;;) {
    const candidate = 'n_' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 4);
    if (!taken.has(candidate)) return candidate;
  }
}

/** 宽松地把磁盘内容读成合法存储；坏行丢弃而不是整体报废。 */
export function normalizeStore(raw) {
  const store = emptyStore();
  if (raw === null || typeof raw !== 'object') return store;
  if (Array.isArray(raw.notes)) {
    const seen = new Set();
    for (const candidate of raw.notes) {
      if (candidate === null || typeof candidate !== 'object') continue;
      const text = normalizeText(candidate.text);
      if (text === null) continue;
      // id 必须唯一：手工编辑或重复撤销可能产生重复 id，前端 key 会冲突
      const usable = typeof candidate.id === 'string' && candidate.id !== '' && !seen.has(candidate.id);
      const id = usable ? candidate.id : nextId(store.notes);
      seen.add(id);
      store.notes.push({
        id,
        text,
        workspaceId: typeof candidate.workspaceId === 'string' && candidate.workspaceId !== '' ? candidate.workspaceId : null,
        sessionId: typeof candidate.sessionId === 'string' && candidate.sessionId !== '' ? candidate.sessionId : null,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
      });
    }
  }
  store.settings = normalizeSettings(raw.settings);
  return store;
}

/** 偏好看成"允许范围内的值，否则取默认"。 */
export function normalizeSettings(raw) {
  const settings = defaultSettings();
  if (raw === null || typeof raw !== 'object') return settings;
  const count = Number(raw.hoverCount);
  if (Number.isFinite(count)) {
    settings.hoverCount = Math.min(HOVER_COUNT_MAX, Math.max(HOVER_COUNT_MIN, Math.round(count)));
  }
  if (typeof raw.hoverEnabled === 'boolean') settings.hoverEnabled = raw.hoverEnabled;
  if (raw.defaultView === 'grouped' || raw.defaultView === 'flat') settings.defaultView = raw.defaultView;
  return settings;
}

/** 按正文找出已收藏的便签（Q22 去重键）。 */
export function findByContent(notes, text) {
  const key = contentKey(text);
  if (key === '') return undefined;
  return (Array.isArray(notes) ? notes : []).find((note) => contentKey(note.text) === key);
}

/** 新增一条；已存在同正文则原样返回（幂等）。 */
export function addNote(store, input, now = new Date().toISOString()) {
  const text = normalizeText(input && input.text);
  if (text === null) return { store, note: null, added: false };
  const existing = findByContent(store.notes, text);
  if (existing !== undefined) return { store, note: existing, added: false };
  if (store.notes.length >= MAX_NOTES) return { store, note: null, added: false, reason: 'full' };
  const note = {
    id: nextId(store.notes),
    text,
    workspaceId: typeof input.workspaceId === 'string' && input.workspaceId !== '' ? input.workspaceId : null,
    sessionId: typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : null,
    createdAt: now,
    updatedAt: now,
  };
  return { store: { ...store, notes: [note, ...store.notes] }, note, added: true };
}

/** 按 id 删除，返回被删掉的那条（供撤销）与剩余存储。 */
export function removeNote(store, id) {
  const index = store.notes.findIndex((note) => note.id === id);
  if (index < 0) return { store, removed: null };
  const removed = store.notes[index];
  const notes = store.notes.slice(0, index).concat(store.notes.slice(index + 1));
  return { store: { ...store, notes }, removed };
}

/** 修改正文；改后与别的便签重复时拒绝，避免出现两条同内容。 */
export function updateNote(store, id, text, now = new Date().toISOString()) {
  const index = store.notes.findIndex((note) => note.id === id);
  if (index < 0) return { store, note: null, reason: 'missing' };
  const nextText = normalizeText(text);
  if (nextText === null) return { store, note: null, reason: 'empty' };
  const duplicate = store.notes.find((note, at) => at !== index && contentKey(note.text) === contentKey(nextText));
  if (duplicate !== undefined) return { store, note: null, reason: 'duplicate' };
  const previous = store.notes[index];
  // 内容没变（只是重新保存同一份文本）时不产生新对象，host 就不落盘。
  if (previous.text === nextText) return { store, note: previous };
  const note = { ...previous, text: nextText, updatedAt: now };
  const notes = store.notes.slice();
  notes[index] = note;
  return { store: { ...store, notes }, note };
}

/**
 * 撤销删除：把原便签插回它原来的位置。
 *
 * 返回 { store, restored, reason }——调用方必须看 restored，
 * 因为「同正文的便签已经存在」时不能静默当成撤销成功（那会弹了 Toast 却什么都没发生）。
 * reason 取值：'ok' | 'invalid' | 'missing-id' | 'id-exists' | 'duplicate'
 * @param {object} store
 * @param {object} note 被删掉的那条原样快照
 * @param {number} index 原位置
 */
export function restoreNote(store, note, index = 0) {
  if (note === null || typeof note !== 'object') return { store, restored: null, reason: 'invalid' };
  if (typeof note.id !== 'string' || note.id === '') return { store, restored: null, reason: 'missing-id' };
  const text = normalizeText(note.text);
  if (text === null) return { store, restored: null, reason: 'invalid' };
  if (store.notes.some((candidate) => candidate.id === note.id)) {
    return { store, restored: null, reason: 'id-exists' };
  }
  if (findByContent(store.notes, text) !== undefined) {
    return { store, restored: null, reason: 'duplicate' };
  }
  const at = Math.min(Math.max(0, index), store.notes.length);
  const notes = store.notes.slice();
  const restored = {
    id: note.id,
    text,
    workspaceId: typeof note.workspaceId === 'string' ? note.workspaceId : null,
    sessionId: typeof note.sessionId === 'string' ? note.sessionId : null,
    createdAt: typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date().toISOString(),
  };
  notes.splice(at, 0, restored);
  return { store: { ...store, notes }, restored, reason: 'ok' };
}

/**
 * 合并偏好补丁，越界值收敛到合法范围。
 *
 * 结果与现有 settings 等价时**原样返回 store 本身**（不是新对象），
 * 这样 host 的 mutate() 才有机会跳过落盘——否则每次「改回原值」都白写一次磁盘。
 * @param {object} store
 * @param {object} patch
 * @returns {object}
 */
export function patchSettings(store, patch) {
  const merged = normalizeSettings({ ...store.settings, ...(patch && typeof patch === 'object' ? patch : {}) });
  const current = store.settings || {};
  if (merged.hoverCount === current.hoverCount
    && merged.hoverEnabled === current.hoverEnabled
    && merged.defaultView === current.defaultView) {
    return store;
  }
  return { ...store, settings: merged };
}

/** 按创建时间倒序的便签副本（最新的在前）。 */
export function sortedNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}
