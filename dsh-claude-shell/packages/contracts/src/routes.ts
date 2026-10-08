/**
 * The plugin's private route names, shared by both halves (D46): the host half
 * registers them under this prefix and the browser half addresses them, so
 * every path is declared once.
 */

/** Route prefix this plugin owns. */
export const ROUTE_PREFIX = '/dsh-claude-shell'

/** One-shot host OS user route; the browser half caches the response and never polls. */
export const USERNAME_PATH = `${ROUTE_PREFIX}/username`

/**
 * The HDSL launcher's account metadata. The browser half cannot read a process
 * environment, so the `HDSL_`-prefixed variables the launcher publishes are
 * forwarded from here; the player's avatar bytes ride HDSL_SKIN_PATH.
 */
export const HDSL_PATH = `${ROUTE_PREFIX}/hdsl`

/** The player's own avatar PNG, forwarded; the absolute path never leaves the host half. */
export const HDSL_SKIN_PATH = `${ROUTE_PREFIX}/hdsl-skin.png`

/**
 * The copy document the settings page reads its strings from; it ships beside
 * the bundle as data and the host half serves it, so the table grows without a
 * rebuild.
 */
export const MODEL_COPY_PATH = `${ROUTE_PREFIX}/model-descriptions.json`
