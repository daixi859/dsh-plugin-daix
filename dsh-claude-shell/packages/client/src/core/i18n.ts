import { MODEL_COPY_FALLBACK_LOCALE } from '../constants'
import { hostCtx } from './host'
import type { HostContext } from './host'
import { modelCopy } from './model-copy'

/** Values for a copy string's `{name}` slots. */
export type CopyParams = Record<string, string | number>

/** The shell's active locale id, or the document fallback when it cannot be read. */
export function activeLocale(ctx?: HostContext | null): string {
  const active = (ctx || hostCtx)?.get('locale')?.getSnapshot().active
  if (typeof active === 'string' && active) return active
  return modelCopy === null ? MODEL_COPY_FALLBACK_LOCALE : modelCopy.fallback
}

/** Fill a copy string's `{name}` slots from `params`; a slot with no value stays as written. */
function fillTemplate(text: string, params?: CopyParams) {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}

/** One localized string out of a `{ locale: text }` pair, fallback locale last. */
export function localized(pair: Record<string, unknown> | null | undefined, ctx?: HostContext | null) {
  if (!pair || typeof pair !== 'object') return ''
  const loc = activeLocale(ctx)
  const text = pair[loc]
  if (typeof text === 'string' && text) return text
  const prefix = typeof loc === 'string' && loc.includes('-') ? loc.split('-')[0] : (typeof loc === 'string' && loc.includes('_') ? loc.split('_')[0] : '')
  const prefixed = pair[prefix]
  if (prefix && typeof prefixed === 'string' && prefixed) return prefixed
  const fallback = modelCopy === null ? MODEL_COPY_FALLBACK_LOCALE : modelCopy.fallback
  const backstop = pair[fallback]
  if (typeof backstop === 'string' && backstop) return backstop
  const fallbackPrefix = typeof fallback === 'string' && fallback.includes('-') ? fallback.split('-')[0] : ''
  const fallbackPrefixed = pair[fallbackPrefix]
  if (fallbackPrefix && typeof fallbackPrefixed === 'string' && fallbackPrefixed) return fallbackPrefixed
  return ''
}

/**
 * One settings-page string. The settings copy rides the same document as the
 * interface's own strings, so the page follows the shell language too — and the
 * English constants stay as the fallback for a failed fetch.
 */
export function settingsCopy(key: string, fallback: string, params?: CopyParams) {
  const text = modelCopy === null || !modelCopy.settings ? '' : localized(modelCopy.settings[key])
  return fillTemplate(text || fallback, params)
}
