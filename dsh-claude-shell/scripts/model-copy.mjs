/**
 * model-copy.mjs — the copy document's check before it ships (D5).
 */
import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/** The copy document and its schema: data beside the browser half's code, never bundled. */
const DATA = path.join(path.resolve(import.meta.dirname, '..'), 'packages', 'client', 'data')
/**
 * Copy ships as DATA beside the bundle, not inside it: the browser half fetches
 * it at runtime (the host half serves it), so the table grows without touching
 * this build. It is validated here so a malformed table fails the build instead
 * of the settings page.
 */
export const MODEL_COPY = 'model-descriptions.json'
/** The copy document's declared shape; validateModelCopy adds the rule a schema cannot see. */
const MODEL_COPY_SCHEMA = 'model-descriptions.schema.json'
const validateModelCopyShape = addFormats(new Ajv2020({ allErrors: true }), ['regex'])
  .compile(JSON.parse(fs.readFileSync(path.join(DATA, MODEL_COPY_SCHEMA), 'utf8')))

/**
 * Check the copy document before it ships. Every failure here is one the
 * settings page could otherwise only express as a silently missing line, so
 * they all throw.
 *
 * The document's shape is declared in packages/client/data/model-descriptions.schema.json:
 * the tables and the `{locale: text}` lines. What a schema cannot see is
 * checked after it: the document must carry at least two locales, so a
 * translation can exist beside the fallback.
 *
 * @param doc - parsed `packages/client/data/model-descriptions.json`.
 * @returns the number of copy keys, for the build log.
 */
export function validateModelCopy(doc) {
  const fail = (message) => {
    throw new Error(`build: ${MODEL_COPY} ${message}`)
  }
  if (!validateModelCopyShape(doc)) {
    fail(validateModelCopyShape.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; '))
  }
  const locales = new Set([doc.fallback])
  let keys = 0
  for (const pair of Object.values(doc.settings)) {
    keys += 1
    for (const locale of Object.keys(pair)) locales.add(locale)
  }
  if (locales.size < 2) fail('carries fewer than two locales; i18n needs at least the fallback and one translation')
  return keys
}
