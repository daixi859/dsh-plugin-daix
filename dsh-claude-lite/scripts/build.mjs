#!/usr/bin/env node
/**
 * build.mjs — bundle lib/client.js for dsh-claude-lite.
 *
 * The DSH module loader takes one file per plugin client, registered with
 * `__ModuleLoader__.load` and handed a `require` for the host packages; it has
 * no relative requires and no asset URLs. So esbuild bundles
 * src/client/entry.ts into one minified CommonJS body — stylesheets inlined
 * as strings by the `.css` text loader — and that body is wrapped in the
 * loader's factory:
 *
 *   src/client/entry.ts      apply(): stylesheet, part walk, title band, prefs
 *   src/client/*.ts          the modules, plain TypeScript
 *   src/client/theme/*.css   the three sheets, concatenated in entry.ts
 *
 * The host half needs no build: src/host/index.js is plain ESM and is copied
 * to lib/host/index.js as it is.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src', 'client')
const OUT = path.join(ROOT, 'lib', 'client.js')

const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_ID = PACKAGE.name

/** Stands where the build id goes until the bundle's own hash is known. */
const BUILD_ID_SLOT = '%%BUILD_ID%%'

const FACTORY_OPEN = `/**
 * Claude Lite — Claude Code style sidebar + title band for the DeepSeek Harness web GUI.
 * GENERATED FILE — do not edit. Source lives in src/client/; \`npm run build\` bundles it.
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports`
const FACTORY_CLOSE = `    return module.exports
  },
})`

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'entry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'esnext',
    charset: 'utf8',
    minify: true,
    logLevel: 'info',
    outfile: OUT,
    write: false,
    loader: { '.css': 'text' },
    banner: { js: FACTORY_OPEN },
    footer: { js: FACTORY_CLOSE },
  })

  const draft = result.outputFiles[0].text
  // The slot and the id have the same length, so offsets the slot anchored hold.
  const buildId = createHash('sha256').update(draft).digest('hex').slice(0, BUILD_ID_SLOT.length)
  if (draft.split(BUILD_ID_SLOT).length !== 2) throw new Error('build: the bundle does not carry the build id slot exactly once')
  const bundle = draft.replace(BUILD_ID_SLOT, buildId)

  // Syntax gate: the bundle must parse before it is written.
  try {
    new vm.Script(bundle, { filename: 'lib/client.js' })
  } catch (error) {
    throw new Error(`build: generated bundle failed to parse: ${error.message}`)
  }

  fs.mkdirSync(path.join(ROOT, 'lib'), { recursive: true })
  fs.writeFileSync(OUT, bundle)
  console.log(`built lib/client.js (${Buffer.byteLength(bundle)} bytes, build ${buildId})`)

  fs.mkdirSync(path.join(ROOT, 'lib', 'host'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'src', 'host', 'index.js'), path.join(ROOT, 'lib', 'host', 'index.js'))
  console.log('built lib/host/index.js (copied as it is)')
}

await main()
