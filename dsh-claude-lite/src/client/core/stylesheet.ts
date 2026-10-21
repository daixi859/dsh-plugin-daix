/**
 * The skin's one stylesheet, mounted as <style id> with its plugin tag.
 *
 * The plugin tag matters: an untagged <style> in the head is unreadable from
 * the outside, and dsh-claude-style parks sheets by the same tag — the tag
 * says whose paint a sheet is.
 */
import { PACKAGE_NAME, STYLE_ID } from '../constants.ts'

let mounted: HTMLStyleElement | null = null
let generation = 0

/**
 * Mount (or hot-swap) the sheet. Returns the stop that removes it; later
 * calls invalidate earlier stops, so a rebuild's swap does not have the old
 * teardown strip the new sheet.
 */
export function mountStylesheet(sheet: string): () => void {
  const mine = ++generation
  if (mounted === null || !mounted.isConnected) {
    mounted = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (mounted === null) {
      mounted = document.createElement('style')
      mounted.id = STYLE_ID
      document.head.appendChild(mounted)
    }
  }
  mounted.dataset.plugin = PACKAGE_NAME
  mounted.dataset.pluginCss = ''
  mounted.textContent = sheet
  return () => {
    if (mine !== generation || mounted === null) return
    mounted.remove()
    mounted = null
  }
}
