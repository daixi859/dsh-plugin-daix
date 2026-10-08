/**
 * build-checks.mjs — the build's refusals that are not about the stylesheets
 * (those are in scripts/css.mjs): the type check, the import graph, every
 * source reaching the bundle and the manifests against the preference table
 * (D36, D42).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadModuleEsm } from './shared/ts-module.cjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'packages', 'client', 'src')
/**
 * The preference table both halves share (packages/contracts/src/prefs.ts, D46):
 * the host half's Config is derived from it and every feature manifest's `pref`
 * has to name a key of it.
 */
const { PREFS_DEFAULT } = await loadModuleEsm('packages/contracts/src/prefs.ts')

/**
 * Refuse a source file that does not ship: a stylesheet no manifest and no
 * theme entry names, or a module nothing imports, would otherwise sit in packages/client/src/
 * with no way to reach the page. Manifests are data the build reads and unit
 * tests run under Vitest; neither is a module the bundle carries.
 *
 * @param bundled - the modules in the bundle (esbuild's metafile), relative to packages/client/src.
 * @param sheets - every stylesheet the bundle carries (styleFiles).
 */
export function checkListed(bundled, sheets) {
  const listed = new Set(sheets.map((sheet) => sheet.file))
  const walk = (dir) => fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) return walk(rel)
    return [rel]
  })
  for (const file of walk('')) {
    if (file.endsWith('.css') && !listed.has(file)) throw new Error(`build: packages/client/src/${file} is in no list; add it to its feature's manifest or to THEME_SHEETS`)
    if (file.endsWith('.manifest.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) continue
    if (file.endsWith('.ts') && !bundled.has(file)) throw new Error(`build: packages/client/src/${file} is imported by no module the bundle reaches`)
  }
}

/**
 * Hold the manifests to the rest of the repository: every feature directory
 * carries at least one manifest, and a `pref` names a key of the shared
 * preference table (packages/contracts/src/prefs.ts, D46), the table the
 * settings form serves.
 *
 * @param manifests - the feature manifests (scripts/shared/read-manifests.cjs).
 */
export function checkManifests(manifests) {
  const covered = new Set(manifests.map((manifest) => manifest.dir))
  for (const dir of fs.readdirSync(path.join(SRC, 'features'), { withFileTypes: true })) {
    if (dir.isDirectory() && !covered.has(dir.name)) throw new Error(`build: packages/client/src/features/${dir.name}/ has no manifest`)
  }
  for (const manifest of manifests) {
    if (manifest.pref !== undefined && !(manifest.pref in PREFS_DEFAULT)) {
      throw new Error(`build: packages/client/src/${manifest.file} names pref "${manifest.pref}", which packages/contracts/src/prefs.ts PREFS_DEFAULT does not carry`)
    }
  }
}

/**
 * Type-check packages/client/src/ (tsconfig.json, strict). esbuild only strips types, so this
 * is what turns a missing import, a misspelt name or a wrong argument into a
 * build failure.
 */
export function checkTypes() {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tsc, '-p', ROOT, '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    process.stderr.write(error.stdout + error.stderr)
    throw new Error('build: tsc reports type errors in packages/client/src/ (listed above)')
  }
}

/**
 * Refuse an import cycle. Modules in a cycle evaluate one before the other has
 * finished, so a constant read across it can be read before it is initialized.
 *
 * @param metafile - esbuild's metafile for the bundle.
 */
export function checkCycles(metafile) {
  const graph = new Map(Object.entries(metafile.inputs).map(([file, input]) => [file, input.imports.filter((item) => !item.external).map((item) => item.path)]))
  const state = new Map()
  const stack = []
  const visit = (file) => {
    state.set(file, 'open')
    stack.push(file)
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 'open') {
        const cycle = [...stack.slice(stack.indexOf(next)), next].join(' → ')
        throw new Error(`build: import cycle ${cycle}`)
      }
      if (!state.has(next)) visit(next)
    }
    stack.pop()
    state.set(file, 'done')
  }
  for (const file of graph.keys()) if (!state.has(file)) visit(file)
}
