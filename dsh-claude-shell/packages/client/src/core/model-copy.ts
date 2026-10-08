import { MODEL_COPY_FALLBACK_LOCALE, MODEL_COPY_ROUTE } from '../constants'
import { createHostResource } from '../shared/resource'
import type { HostAnswer } from '../shared/resource'

/** One `{ locale: text }` pair of the copy document. */
export type CopyPair = Record<string, string>

/** The copy document, indexed for lookups. */
export interface ModelCopyIndex {
  settings: Record<string, CopyPair>
  fallback: string
}

/**
 * The settings page's localized copy.
 *
 * The copy document ships as `model-descriptions.json` beside the bundle and
 * the browser half fetches it at runtime (the host half serves it), so the
 * table grows without a rebuild and no copy enters the bundle. The settings
 * section (packages/client/src/features/settings/settings.ts) consumes it through core/i18n.
 */
export let modelCopy: ModelCopyIndex | null = null

/**
 * The copy document the host half serves. A document that does not index is
 * not adopted: the bundle's English constants stay.
 */
const modelCopyResource = createHostResource(MODEL_COPY_ROUTE, (doc) => {
  const indexed = indexModelCopy(doc)
  if (indexed === null) return undefined
  modelCopy = indexed
  return modelCopy
})

export function onModelCopyLoaded(listener: (copy: ModelCopyIndex) => void) {
  return modelCopyResource.onLoaded(listener)
}

/**
 * Fetch the copy document the host half serves.
 */
export function loadModelCopy() {
  modelCopyResource.load()
}

/**
 * Compile a copy document into the shape lookups want.
 * @param doc - parsed document, as validated by the build.
 * @returns the index, or null when the document is unusable.
 */
function indexModelCopy(doc: HostAnswer): ModelCopyIndex | null {
  if (!doc || typeof doc !== 'object') return null
  // The build validated the document's shape before it shipped (D5); a block
  // that is missing reads as empty.
  const table = <T>(value: unknown) => (value && typeof value === 'object' ? value : {}) as Record<string, T>
  return {
    settings: table(doc.settings),
    fallback: typeof doc.fallback === 'string' && doc.fallback ? doc.fallback : MODEL_COPY_FALLBACK_LOCALE,
  }
}
