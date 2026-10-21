/**
 * The constants both halves of the client agree on.
 *
 * The build id slot is replaced by scripts/build.mjs with the bundle's own
 * hash, so a live page can be matched to the lib/client.js it runs.
 */

/** The plugin id, as the loader and the stylesheet tag carry it. */
export const PACKAGE_NAME = 'dsh-claude-lite'

/** The build id written on <body data-dsh-lite> once the bundle is hashed. */
export const BUILD_ID = '%%BUILD_ID%%'

/** The skin attribute on <body>: the mark a page carries when this skin runs. */
export const SKIN_ATTR = 'data-dsh-lite'

/** The theme choice, mirrored from the settings form onto <body>. */
export const THEME_ATTR = 'data-dsh-lite-theme'

/** The theme choices, with the default first. */
export const THEME_CLAUDE = 'claude'
export const THEME_CLAUDE_LIGHT = 'claude-light'
export const THEME_HOST = 'host'
export const THEMES = [THEME_CLAUDE, THEME_CLAUDE_LIGHT, THEME_HOST] as const

/** The stylesheet element's id and its plugin tag. */
export const STYLE_ID = 'dsh-claude-lite-stylesheet'

/** The host slots the part walk reads the page through (dsh-claude-style contracts). */
export const ROOT_SLOT_SELECTOR = '[data-slot="root"]'
export const SIDEBAR_SLOT_SELECTOR = '[data-slot="sidebar"]'
export const CONVERSATION_HEADER_SLOT_SELECTOR = '[data-slot="conversation.header"]'

/** The header's parts, matched on the walk's own stamps (not on host classes). */
export const CONVERSATION_HEADER_SELECTOR = '[data-dsh-lite-part~="conversation-header"]'
export const TITLE_ROW_SELECTOR = '[data-dsh-lite-part~="title-row"]'
export const VIEW_TABS_SELECTOR = '[data-dsh-lite-part~="view-tabs"]'

/** The host's caption-strip menu mark, published by the harness shell. */
export const WINDOWS_MENU_SELECTOR = '[data-windows-menu]'

/**
 * The preference keys the settings form carries and the custom properties the
 * free-form ones are written to — inline on <html>, as --dsh-lite-user-*, so
 * they outrank every token default in the sheets. Empty string means "not
 * set": the property is removed and the token's own value stands.
 */
export const PREF_VARS: Record<string, string> = {
  accent: '--dsh-lite-user-accent',
  sidebarBg: '--dsh-lite-user-sidebar',
  canvasBg: '--dsh-lite-user-canvas',
}
