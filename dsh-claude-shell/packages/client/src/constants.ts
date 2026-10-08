/**
 * The constants the build reads out of the browser half: the gate attributes
 * scripts/css.mjs checks on the syntax tree, the values preferences hold with
 * the attribute names they resolve onto, and the preference defaults —
 * scripts/build.mjs evaluates this module and picks those names. The
 * stylesheets spell the attributes out; the build holds every one they read to
 * a name the browser half writes. The identity constants and the host half's
 * route re-exports live here too.
 */
import { PREFS_DEFAULT } from '@dsh-claude-shell/contracts/prefs'

export const STYLE_ID = 'dsh-claude-shell-style'

/**
 * Settings identity.
 *
 * A settings namespace IS a profile entry id and its schema IS the entry's
 * Config, so the id below is what both halves address — read off the
 * running loader entry where possible, with the id `cordis.patch.yml`
 * inserts as the fallback.
 *
 * PACKAGE_NAME is the other half of the contract: a bundle's own
 * configuration is a `plugins.bundle.config` entry keyed by the bundle's
 * package name, which is what makes it render on this plugin's page.
 */
export const SETTINGS_ENTRY_FALLBACK = 'ui-skin-claude-shell'
export const PACKAGE_NAME = 'dsh-claude-shell'
/**
 * The skin stylesheet's own key in the client module system's bookkeeping:
 * the sheet is mounted tagged `data-plugin="<PACKAGE_NAME>"` and
 * `data-plugin-css="<STYLE_PLUGIN_CSS>"`, which is what keeps the host's
 * claim sweep and every sibling package's removal off it (D33).
 */
export const STYLE_PLUGIN_CSS = `${PACKAGE_NAME}/client.css`
/**
 * The tag this package gives a sibling's untagged stylesheet so the host's
 * claim sweep cannot attribute it to this package (D33). It carries a slash,
 * so it can never equal a package name — the id every removal step matches
 * on — and no package's reload takes the sheet away.
 */
export const FOREIGN_SHEET_TAG = `${PACKAGE_NAME}/foreign-sheet`
export const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'
export const SETTINGS_SECTION_SLOT = 'settings.section'

/**
 * Preferences, persisted in the profile entry's settings namespace (the
 * exported Config in packages/host/src/settings.ts declares the fields;
 * packages/client/src/core/prefs.ts reads and writes them). Each value is
 * mirrored onto the document as an attribute so the stylesheet decides what a
 * preference means, and the defaults are the shared contract
 * (packages/contracts/src/prefs.ts, D46).
 */

/** Brand marks selectable from the settings page. `claude` is the default. */
export const BRAND_CLAUDE = 'claude'
/**
 * The DeepSeek mark: the sidebar's own brand art and the account avatar draw
 * DeepSeek's whale instead of the skin's Claude marks. The choice decides the
 * MARK alone; the colours come from the palette preference below, so the whale
 * can stand on the warm canvas the same way the starburst can stand on the
 * blue one.
 */
export const BRAND_DEEPSEEK = 'deepseek'
/** What earlier builds stored for the DeepSeek choice, when it was labelled "Off". */
export const BRAND_DEEPSEEK_LEGACY = 'off'
/** The document attribute the stylesheet switches on. */
export const BRAND_ATTR = 'data-dsh-claude-shell-brand'

/**
 * The animation choice, and the document attribute it resolves onto.
 *
 * Three values in the settings page, two on the document: `system` follows
 * the operating system's own reduced-motion setting, `reduced` holds every
 * animation still whatever the system says, and `full` always plays them.
 * The resolved answer rides <body> as MOTION_ATTR (`reduced` / `full`), so
 * the stylesheets read one value instead of asking the system separately —
 * which is the only way "always play" can override it.
 */
export const MOTION_SYSTEM = 'system'
export const MOTION_REDUCED = 'reduced'
export const MOTION_FULL = 'full'
export const MOTION_MODES = [MOTION_SYSTEM, MOTION_REDUCED, MOTION_FULL]
export const MOTION_ATTR = 'data-dsh-claude-shell-motion'

/**
 * Which colours the skin paints with, and separately who sets the type.
 *
 * Two skin palettes and one stand-down: `claude` is the skin's warm palette,
 * `deepseek` its blue one, and `host` leaves the host's colour tokens to the
 * host and to whatever other theme plugin writes them — a wallpaper plugin's
 * glass, say — while the skin's own surfaces read those tokens through its
 * private aliases. Whichever mark the brand preference selects, the palette
 * decides every colour, the mark's ink included. Each choice rides <body> as
 * its attribute, and the stylesheet gates every rule that writes the host's
 * tokens on it.
 */
export const PALETTE_CLAUDE = 'claude'
export const PALETTE_DEEPSEEK = 'deepseek'
export const PALETTE_HOST = 'host'
export const PALETTES = [PALETTE_CLAUDE, PALETTE_DEEPSEEK, PALETTE_HOST]
export const PALETTE_ATTR = 'data-dsh-claude-shell-palette'
export const TYPEFACE_CLAUDE = 'claude'
export const TYPEFACE_HOST = 'host'
export const TYPEFACES = [TYPEFACE_CLAUDE, TYPEFACE_HOST]
export const TYPEFACE_ATTR = 'data-dsh-claude-shell-typeface'

/**
 * Feature switches: one preference per feature that replaces or moves a host
 * control, on by default. Each feature's manifest names its key (`pref`, D42);
 * a stored `false` runs the feature's teardown, which hands its surface back
 * to the host.
 */
export const FEATURE_PREF_DEFAULTS = {
  viewTabs: true,
  headerBand: true,
}

/**
 * On a node the skin owns purely for its own bookkeeping — a measuring probe
 * or a decorative layer. The shared scheduler ignores mutations against such
 * a node (D40), so measuring or redrawing never wakes a pass that no feature
 * needs.
 */
export const QUIET_ATTR = 'data-dsh-claude-shell-quiet'
/** Present while the skin takes over the sidebar footer (settings area + account row). */
export const FOOTER_ATTR = 'data-dsh-claude-shell-footer-takeover'
/**
 * Stamped on the host's own account menu card while it is open (Desktop
 * 0.1.7+). That card is the host's shared Menu portal and its class names
 * are hashed, so packages/client/src/features/account/surface.ts stamps this attribute and
 * features/account/account-footer.css repaints the card, its rows and its
 * separators with the skin's popover language.
 */
export const ACCOUNT_MENU_ATTR = 'data-dsh-claude-shell-account-menu'
/**
 * Set on <body> from the moment the account row is hovered or pressed until
 * its menu closes. The card's own marker needs the menu's rows to identify
 * the card, so it lands two or three frames after the host has already
 * painted the card; an entry animation keyed on it therefore replayed from
 * transparent over a card that was already visible. This one is in place
 * before the host mounts the card, so the animation runs from its first
 * frame.
 */
export const ACCOUNT_ARMED_ATTR = 'data-dsh-claude-shell-account-armed'
/**
 * Stamped on the host's account card by packages/client/src/features/account/surface.ts once
 * the card carries the skin's rows and the host has finished placing it.
 *
 * The host mounts the card with its own rows and places it from that
 * geometry; the skin's container lands a frame later and the card grows, and
 * the host re-places it a frame after that. Revealing on the mount frame
 * fades the card in at a height and a place it is about to leave — it appears
 * low and jumps up mid-fade — so features/account/account-footer.css holds it
 * inside the armed window until this marker lands, and the entry animation
 * hangs on this marker.
 */
export const ACCOUNT_READY_ATTR = 'data-dsh-claude-shell-account-ready'
/**
 * The handoff marker: stamped on `body` while this build is live AND able
 * to give the page back (D49). Its presence is a capability another
 * package can read without running anything: a skin that lists this theme
 * as one of its looks has to know the page can come back, and a build from
 * before D49 does not stamp it.
 */
export const HANDOFF_ATTR = 'data-dsh-claude-shell-handoff'
/**
 * The document attribute the skin center stamps while a skin is painting
 * (D49). It is read at boot and watched afterwards: the value is the skin
 * id, and the presence means the page belongs to a skin.
 */
export const SKIN_STAMP_ATTR = 'data-dsh-skin'
/**
 * On the host's scroller around the settings page while the page is
 * mounted (packages/client/src/features/settings/settings.ts): the stylesheet keeps the
 * scrollbar's room there, so switching tabs never shifts the layout.
 */
export const SETTINGS_SCROLLER_ATTR = 'data-dsh-claude-shell-settings-scroller'

/**
 * The host half's private routes, under this half's own names. The paths are
 * the shared contract (packages/contracts/src/routes.ts, D46), declared once
 * for both halves.
 */
export {
  HDSL_PATH as HDSL_ROUTE,
  HDSL_SKIN_PATH as HDSL_SKIN_ROUTE,
  MODEL_COPY_PATH as MODEL_COPY_ROUTE,
  USERNAME_PATH as USERNAME_ROUTE,
} from '@dsh-claude-shell/contracts/routes'

/** The copy document's fallback locale, read before the document itself arrives. */
export const MODEL_COPY_FALLBACK_LOCALE = 'en'

/**
 * How eagerly the account popover opens on hover: `off` is click-only,
 * `account` auto-opens the sidebar account popover.
 */
export const AUTO_POPOVER_OFF = 'off'
export const AUTO_POPOVER_ACCOUNT = 'account'
export const AUTO_POPOVER_SCOPES = [AUTO_POPOVER_OFF, AUTO_POPOVER_ACCOUNT]

/**
 * The preference shape the browser half reads: one field per key of the shared
 * defaults table, whose values hold until the settings form answers. A boolean
 * preference is on unless stored as an explicit `false`.
 */
export interface Prefs {
  brand: string
  motion: string
  collapseFooter: boolean
  autoPopover: string
  username: string
  palette: string
  typeface: string
  viewTabs: boolean
  headerBand: boolean
}

/** Every preference's shipped default, from the table both halves share (packages/contracts/src/prefs.ts, D46). */
export const PREF_DEFAULTS: Prefs = PREFS_DEFAULT

/** The preferences whose value is one of a fixed set; any other stored value reads as the default. */
export const PREF_CHOICES: Partial<Record<keyof Prefs, string[]>> = {
  motion: MOTION_MODES,
  autoPopover: AUTO_POPOVER_SCOPES,
  palette: PALETTES,
  typeface: TYPEFACES,
}
/** Longest accepted custom username; core/prefs.ts trims the stored value to it. */
export const USERNAME_MAX = 64
