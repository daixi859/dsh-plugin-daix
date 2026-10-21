/**
 * The preferences: bind the profile entry's config form, mirror the values
 * onto the document, and keep the mirror current.
 *
 * The host projects the settings form from the plugin's Config and serves the
 * values through the configForms service; the form's namespace is named after
 * the entry, read the same way dsh-claude-shell reads it. The client never
 * writes — the settings page owns the values — it only mirrors.
 */
import { PREF_VARS, THEME_ATTR, THEMES, THEME_CLAUDE } from '../constants.ts'
import type { HostContext } from './host.ts'

interface FormSnapshot { status?: string, value?: Record<string, unknown> }
interface ConfigForm {
  getSnapshot?(): FormSnapshot
  subscribe?(callback: () => void): () => void
}
interface ConfigFormsService {
  describe?(): { view?: { namespaces?: Record<string, unknown> } } | undefined
  get?(name: string): ConfigForm | undefined
}

/** The mirrored theme plus the free-form custom properties. */
export interface Prefs {
  theme: string
  vars: Record<string, string>
}

/** The defaults a page runs on before (or without) its form. */
export function defaultPrefs(): Prefs {
  const vars: Record<string, string> = {}
  for (const key of Object.keys(PREF_VARS)) vars[key] = ''
  return { theme: THEME_CLAUDE, vars }
}

/** Clamp one snapshot into prefs: unknown values fall to the defaults. */
export function normalizePrefs(value: Record<string, unknown> | undefined): Prefs {
  const prefs = defaultPrefs()
  if (value === undefined || value === null) return prefs
  const theme = value.theme
  prefs.theme = typeof theme === 'string' && (THEMES as readonly string[]).includes(theme) ? theme : THEME_CLAUDE
  for (const [key, property] of Object.entries(PREF_VARS)) {
    const raw = value[key]
    prefs.vars[key] = typeof raw === 'string' ? raw.trim() : ''
  }
  return prefs
}

let prefs: Prefs = defaultPrefs()
const listeners = new Set<() => void>()

/** The current mirror. */
export function currentPrefs(): Prefs {
  return prefs
}

/** Write the mirror onto the document: the theme on <body>, the vars on :root. */
export function adoptPrefs(next: Prefs): void {
  prefs = next
  document.body.setAttribute(THEME_ATTR, prefs.theme)
  const rootStyle = document.documentElement.style
  for (const [key, property] of Object.entries(PREF_VARS)) {
    const value = prefs.vars[key] ?? ''
    if (value === '') rootStyle.removeProperty(property)
    else rootStyle.setProperty(property, value)
  }
  for (const listener of listeners) listener()
}

/** Subscribe to mirror changes; the band re-measures on a palette flip. */
export function subscribePrefs(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/**
 * Bind the entry's config form, adopt its snapshot and keep adopting on every
 * change. Everything is defensive: a host without the service, or without a
 * form for this entry, leaves the defaults standing.
 */
export async function bindPrefs(ctx: HostContext): Promise<void> {
  let forms: ConfigFormsService | undefined
  try {
    forms = ctx.get<ConfigFormsService>('configForms')
  } catch { /* no configForms: the defaults stand */ }
  if (forms === undefined || forms === null) return

  // The form is named after the profile entry; the entry id's tail and the
  // package name are the candidates, read the way the shell reads its own.
  const entryId = ctx.fiber?.entry?.id ?? ''
  const tail = entryId.split('.').pop() ?? ''
  const candidates = [entryId, tail, 'dsh-claude-lite'].filter((name) => name !== '')

  let form: ConfigForm | undefined
  try {
    const namespaces = forms.describe?.()?.view?.namespaces ?? {}
    const names = Object.keys(namespaces)
    form = candidates
      .map((name) => names.find((ns) => ns === name || ns.endsWith(`.${name}`) || ns.includes(name)))
      .map((name) => (name === undefined ? undefined : (namespaces as Record<string, ConfigForm>)[name]))
      .find((found) => found !== undefined)
    if (form === undefined && typeof forms.get === 'function') {
      form = candidates.map((name) => forms.get?.(name)).find((found) => found != null)
    }
  } catch { /* an unreadable catalog: the defaults stand */ }
  if (form === undefined) return

  const adopt = () => {
    try {
      const snapshot = form?.getSnapshot?.()
      if (snapshot?.status !== 'ready' && snapshot?.value === undefined) return
      adoptPrefs(normalizePrefs(snapshot.value))
    } catch { /* a half-written snapshot: keep the last good mirror */ }
  }
  adopt()
  try {
    form.subscribe?.(adopt)
  } catch { /* a form without subscriptions still starts from its snapshot */ }
}
