/**
 * The DOM half of the host contract (D44): every selector or attribute the
 * host itself writes and this skin reads.
 *
 * The host's class names carry a build-time hash and change with every release,
 * so the skin keys on these instead; interface text changes with the language,
 * so it is never matched either (D3). Each literal carries what it means and
 * which feature reads it in its own comment: a host upgrade is audited by
 * walking this file against the page.
 *
 * Everything here is a promise the host makes today and the skin relies on.
 * What the skin itself writes stays with the feature that writes it.
 */

/* ---------- the sidebar footer ---------- */

/** The sidebar footer block; the skin's account entry lives inside it. */
export const FOOT_AREA_SELECTOR = '[class*="footArea"]'
/** The sidebar's action list, whose entries the skin mirrors into its drawer. */
export const FOOTER_ACTIONS_SELECTOR = '[class*="footerActions"]'
/** The host's menu card and its list, which the skin injects a row into. */
export const MENU_ROLE_SELECTOR = '[role="menu"]'
/** The host's settings button in the footer. */
export const SETTINGS_BUTTON_SELECTOR = '[class*="settingsArea"] button[aria-haspopup="dialog"]'

/* ---------- the conversation header's own row ---------- */

/**
 * The header's title row: the line the title cluster, the utilities and the
 * corner seat share. The band placement measures against it, because the
 * title's own box moves with the placement. Rows of the same shape sit in the
 * sidebar's panels, so a reader takes the one carrying a title or the
 * utilities rather than the first match.
 */
export const HEADER_TITLE_ROW_SELECTOR = '[class*="titleRow"]'
/**
 * The session title's breadcrumb nav: the words themselves, not the flex
 * cluster that lays them out (the cluster stretches, so it says nothing about
 * where the title ends).
 */
export const HEADER_TITLE_SELECTOR = '[class*="_crumbs"]'
/** The header's utilities cluster: the workspace opener, the overflow menu, the bottom-panel toggle. */
export const HEADER_UTILITIES_SELECTOR = '[class*="headerUtilities"]'
/** The corner seat beside the utilities, carrying the right-sidebar toggle. */
export const HEADER_CORNER_SELECTOR = '[class*="headerCorner"]'
/**
 * The conversation header itself, resolved with `closest` from the title row:
 * the same substring names a dozen other bars (the sidebar's action row, the
 * background-task chip), so it is never queried document-wide.
 */
export const CONVERSATION_HEADER_SELECTOR = '[class*="_header"]'
/** The view-tab strip inside the header, whose box the band placement keeps clear of. */
export const VIEW_TABS_STRIP_SELECTOR = '[class*="_tabs"]'

/* ---------- the document, the shell and the browser API ---------- */

/** The shell's window marks: the Windows caption row, and fullscreen. */
export const WINDOWS_TITLEBAR_ATTRIBUTE = 'data-windows-titlebar'
export const FULLSCREEN_ATTRIBUTE = 'data-fullscreen'
/**
 * The desktop shell's own seat in the Windows caption row, where its native
 * menu is drawn: the row's content starts to the right of it.
 */
export const WINDOWS_MENU_SELECTOR = '[data-windows-menu]'
/** The host's declared caption-strip height, as a custom property on the document element. */
export const FRAME_TOP_CLEARANCE_PROPERTY = '--dsh-frame-top-clearance'
/** The host's own light/dark flip, written on `<body>`. */
export const DARK_THEME_ATTRIBUTE = 'data-ds-dark-theme'
/** Every untagged stylesheet in `<head>`: the host's claim sweep would otherwise take a sibling's. */
export const UNTAGGED_SHEET_SELECTOR = 'style:not([data-plugin])'
