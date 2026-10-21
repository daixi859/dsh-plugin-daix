/**
 * The client entry: one effect owns the whole skin.
 *
 * The loader calls apply once per page; the effect registers its teardown, so
 * a disable or a hot swap strips the marks, the sheet, the walk, the band and
 * the form binding in one move. Order matters: the skin mark first (rules
 * gate on it), the prefs mirror before the sheet (the sheet reads the theme
 * attribute on its first pass), the walk before the band (the band matches
 * the walk's stamps).
 */
import { BUILD_ID, PACKAGE_NAME, SKIN_ATTR } from './constants.ts'
import { adoptPrefs, bindPrefs, defaultPrefs, subscribePrefs } from './core/prefs.ts'
import type { HostContext } from './core/host.ts'
import { mountStylesheet } from './core/stylesheet.ts'
import { installBand, resyncBand } from './engine/band.ts'
import { installParts } from './engine/parts.ts'
// The three sheets, concatenated in cascade order (theme/lite.css lists the
// same order for readers; the text loader does not follow @import).
import tokens from './theme/tokens.css'
import bandSheet from './theme/band.css'
import sidebarSheet from './theme/sidebar.css'

const sheet = `${tokens}\n${bandSheet}\n${sidebarSheet}`

/** The client half's entry, as the dsh client contract calls it. */
export function apply(ctx: HostContext): void {
  ctx.effect(() => {
    const body = document.body
    const releases: Array<() => void> = []

    // The skin mark: this page runs this skin, this build.
    body.setAttribute(SKIN_ATTR, BUILD_ID)
    body.dataset.pluginSkin = PACKAGE_NAME

    // The mirror starts from the defaults, so the sheet never reads an
    // unthemed page; the form binding overrides as soon as it lands. A
    // palette flip re-measures the band (title colours change its boxes).
    adoptPrefs(defaultPrefs())
    releases.push(subscribePrefs(resyncBand))

    releases.push(mountStylesheet(sheet))
    releases.push(installParts())
    releases.push(installBand())

    // The settings form binds late and defensively; a page without the
    // service just keeps the defaults.
    void bindPrefs(ctx).catch(() => { /* the defaults stand */ })

    return () => {
      for (const release of releases) {
        try { release() } catch { /* teardown keeps going */ }
      }
      body.removeAttribute(SKIN_ATTR)
      delete body.dataset.pluginSkin
    }
  }, `${PACKAGE_NAME}:skin`)
}
