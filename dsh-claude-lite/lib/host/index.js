/**
 * dsh-claude-lite — host half.
 *
 * The skin's effect is browser-only. This half exists for one thing: the
 * preferences schema. The host derives the plugin's settings form from the
 * profile entry's Config and hands the values to the browser half through the
 * configForms service, so a theme switch is a settings edit — no page of our
 * own is shipped (dsh-claude-style's lesson: a skin this small does not carry
 * a settings UI).
 *
 * Everything is defensive: a host that cannot resolve schemastery still loads
 * the skin — it just loses the settings form and the browser half runs on its
 * defaults.
 */

/**
 * The schemastery instance the HARNESS itself resolves (the same resolution
 * dsh-claude-shell uses): a plugin installed by link resolves its realpath
 * outside the profile tree, so plain import fails and the fallback can be a
 * different installation. The harness always carries schemastery beside its
 * own bin, and that is the instance the settings domain validates against.
 *
 * @returns {Promise<SchemaFactory|null>}
 */
async function resolveSchemaFactory() {
  try {
    const { createRequire } = await import('node:module')
    const anchor = typeof process.argv[1] === 'string' && process.argv[1] !== '' ? process.argv[1] : process.execPath
    const factory = createRequire(anchor)('@deepseek-ai/schemastery')
    if (factory != null && typeof factory.object === 'function') return factory
  } catch { /* the anchor carries no schemastery: try normal resolution */ }
  try {
    const resolved = await import('@deepseek-ai/schemastery')
    const factory = resolved?.default ?? resolved?.Schema ?? null
    return factory != null && typeof factory.object === 'function' ? factory : null
  } catch {
    return null
  }
}

/** Mark one field editable by the settings page, where the factory supports it. */
function volatileField(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

const SchemaFactory = await resolveSchemaFactory()

/**
 * The declared preferences.
 *
 * - `theme` — `claude`（暗）· `claude-light`（亮）· `host`（跟随宿主）。
 * - `accent` / `sidebarBg` / `canvasBg` — free-form CSS values written onto
 *   the document element as custom properties; empty means "not set".
 *
 * The browser half clamps everything it reads, so the field types stay
 * permissive on purpose.
 */
export const Config = SchemaFactory == null ? undefined : SchemaFactory.object({
  theme: volatileField(SchemaFactory.union(['claude', 'claude-light', 'host'])).default('claude'),
  accent: volatileField(SchemaFactory.string()).default(''),
  sidebarBg: volatileField(SchemaFactory.string()).default(''),
  canvasBg: volatileField(SchemaFactory.string()).default(''),
})

export const name = 'dsh-claude-lite'

/**
 * Register the plugin's host surfaces. There are none beyond the Config
 * itself: no routes, and no settings presentation of our own — the host
 * projects the form from the schema (leaving its `auto` default standing).
 * The empty apply keeps the entry shape a dsh plugin expects.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  void ctx
}
