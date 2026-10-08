#!/usr/bin/env node
/**
 * build.mjs — bundle `lib/client.js` from the TypeScript modules and stylesheets in `packages/client/src/` (D36).
 *
 * The DSH module loader takes one file per plugin client, registered with
 * `__ModuleLoader__.load` and handed a `require` for the packages the host
 * provides; it has no relative requires and no asset URLs. So esbuild bundles
 * packages/client/src/entry.ts into one minified CommonJS body with React and the host packages
 * external, and that body is wrapped in the loader's factory:
 *
 *   packages/client/src/entry.ts                 apply(): the FEATURES table, every feature eager
 *   packages/client/src/constants.ts             constants
 *   packages/client/src/core/ packages/client/src/shared/ packages/client/src/features/<name>/   the modules, TypeScript, strict
 *   packages/client/src/features/<dir>/<main>.manifest.ts   each feature's manifest (D42), read by scripts/shared/read-manifests.cjs
 *   packages/client/src/theme/*.css and the feature stylesheets   concatenated by rank (THEME_SHEETS and the manifests),
 *                                checked on the syntax tree (scripts/css.mjs)
 *   packages/client/src/theme/tokens.json        the design tokens: the token sheet and the brand marks' addresses
 *   packages/assets/src/brand/            the brand marks, each inlined as a data URI in the token sheet
 *   packages/assets/src/fonts/            the four faces the package ships with their licences and
 *                                authors file, copied to lib/fonts/ (buildFonts)
 *
 * What the build produces for the browser half reaches the source as one
 * generated module, `virtual:dsh-claude-shell/generated` (typed in
 * packages/client/src/generated.d.ts): the stylesheet and the build id.
 *
 * Before anything is written, `tsc` type-checks packages/client/src/ and the bundle's import
 * graph must hold no cycle: a missing import, a cycle or a constant read before
 * it is initialized fails the build. Those refusals are in scripts/build-checks.mjs,
 * the stylesheets' in scripts/css.mjs; the two generated modules are
 * scripts/virtual-modules.mjs.
 *
 * `packages/client/data/model-descriptions.json` is not bundled: it is validated
 * (scripts/model-copy.mjs) and copied to `lib/`, where the host half serves it to
 * the browser half at runtime. Copy is data, so it must not enter the bundle (D5).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import esbuild from 'esbuild'
import { buildHostHalf } from '../packages/host/build.mjs'
import { buildFonts, planBrandMarks } from '../packages/assets/assets.mjs'
import { checkCycles, checkListed, checkManifests, checkTypes } from './build-checks.mjs'
import { TOKEN_SHEET, buildStylesheet, loadTokens } from './css.mjs'
import { MODEL_COPY, validateModelCopy } from './model-copy.mjs'
import manifestReader from './shared/read-manifests.cjs'
import { loadModule } from './shared/ts-module.cjs'
import { featuresModule, generatedModule } from './virtual-modules.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'packages', 'client', 'src')
/** The copy document: data beside the browser half's code, never bundled. */
const DATA = path.join(ROOT, 'packages', 'client', 'data')
/** The brand marks and the fonts; packages/assets/assets.mjs plans their delivery (D38). */
const ASSETS = path.join(ROOT, 'packages', 'assets', 'src')
/** The plugin icon the manifest names, copied into lib/ as it is. */
const BRAND_ASSETS = path.join(ASSETS, 'brand')
const LIB = path.join(ROOT, 'lib')
const OUT = path.join(LIB, 'client.js')

/**
 * The plugin icon the 0.1.7 plugin manifest reads.
 *
 * `package.json` declares it as `icon`, a path relative to the manifest
 * (SVG/PNG/JPEG/WebP, at most 256 KiB, inside the package directory); the host
 * reads the bytes and hands the client a base64 data URI for an `<img>`. It is
 * copied like the copy document so the source of truth stays in the assets tree
 * and `lib/` remains generated output.
 *
 * The clay mark is the one that reads on both canvases: an `<img>` cannot
 * inherit `currentColor` the way the inlined brand art does, and the plain
 * mark is black — invisible on the warm-black canvas.
 */
const ICON_SOURCE = 'claude-mark-clay.svg'
const ICON_FILE = 'claude-mark.svg'

/**
 * The stylesheets that belong to no feature, with their place in the
 * concatenated sheet. A feature's own sheets come from its manifest (D42),
 * each with a rank on this same scale; the build sorts the two together.
 * The order is the cascade: where two rules meet at the same specificity,
 * the later one wins.
 */
const THEME_SHEETS = [
  // Generated from packages/client/src/theme/tokens.json (scripts/css.mjs).
  { file: TOKEN_SHEET, rank: 5 },
  { file: 'theme/tokens.css', rank: 10 },
  { file: 'theme/typography.css', rank: 20 },
  // Shared parts before every feature: a feature's own rule comes later and
  // wins where the two meet at the same specificity.
  { file: 'shared/popover.css', rank: 30 },
  { file: 'shared/sliding-pill.css', rank: 40 },
  { file: 'theme/chrome.css', rank: 50 },
  { file: 'theme/sidebar.css', rank: 110 },
  { file: 'theme/third-party.css', rank: 300 },
]

/**
 * Every stylesheet in cascade order: the theme's and each manifest's, sorted
 * by rank. A rank two sheets share would leave their order to chance, so it
 * fails the build.
 *
 * @param manifests - the feature manifests (scripts/shared/read-manifests.cjs).
 * @returns `{ file, rank }` with `file` relative to packages/client/src.
 */
function styleFiles(manifests) {
  const sheets = [
    ...THEME_SHEETS,
    ...manifests.flatMap((manifest) => manifest.stylesheets.map((sheet) => ({ ...sheet, file: `features/${manifest.dir}/${sheet.file}` }))),
  ].sort((a, b) => a.rank - b.rank)
  for (let i = 1; i < sheets.length; i++) {
    if (sheets[i].rank === sheets[i - 1].rank) throw new Error(`build: packages/client/src/${sheets[i - 1].file} and packages/client/src/${sheets[i].file} share the stylesheet rank ${sheets[i].rank}`)
  }
  return sheets
}

/** The package's own manifest; the loader id and the stylesheet's tag carry its name (D33). */
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_ID = PACKAGE.name

/** The packages the host's loader hands the factory's `require`; never bundled. */
const HOST_PACKAGES = ['react', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives']

/** Stands where the build id goes until the bundle's own hash is known. */
const BUILD_ID_SLOT = '%%BUILD_ID%%'

/**
 * The loader's factory around esbuild's CommonJS body: `require` resolves the
 * external packages, and what the body puts on `module.exports` (`apply`) is
 * what the factory returns to the host.
 */
const FACTORY_OPEN = `/**
 * Claude Shell — Claude Code style shell for the DeepSeek Harness web GUI.
 * GENERATED FILE — do not edit. Source lives in packages/client/src/; \`npm run build\` bundles it.
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports`
const FACTORY_CLOSE = `    return module.exports
  },
})`

/**
 * Evaluate packages/client/src/constants.ts once (pure, DOM-free): the gate attributes the
 * stylesheets are checked against and the preference defaults the browser half
 * carries.
 */
const CONSTANTS = (() => {
  const constantsFile = 'packages/client/src/constants.ts'
  const constants = loadModule(constantsFile)
  const pick = (module, file, names) => Object.fromEntries(names.map((name) => {
    if (module[name] === undefined) throw new Error(`build: ${file} exports no ${name}`)
    return [name, module[name]]
  }))
  const {
    PALETTE_ATTR, PALETTE_CLAUDE, PALETTE_DEEPSEEK, PALETTE_HOST,
    TYPEFACE_ATTR, TYPEFACE_CLAUDE, TYPEFACE_HOST,
  } = pick(constants, constantsFile, [
    'PALETTE_ATTR', 'PALETTE_CLAUDE', 'PALETTE_DEEPSEEK', 'PALETTE_HOST',
    'TYPEFACE_ATTR', 'TYPEFACE_CLAUDE', 'TYPEFACE_HOST',
  ])
  return {
    // The gate attributes scripts/css.mjs checks and writes the token blocks
    // under: which colours the skin paints, and who sets the type (D30). The
    // brand preference picks a MARK, not a colour, so it gates nothing here.
    gates: {
      palette: {
        attribute: PALETTE_ATTR,
        claude: PALETTE_CLAUDE,
        deepseek: PALETTE_DEEPSEEK,
        host: PALETTE_HOST,
        skin: [PALETTE_CLAUDE, PALETTE_DEEPSEEK],
      },
      typeface: { attribute: TYPEFACE_ATTR, claude: TYPEFACE_CLAUDE, host: TYPEFACE_HOST },
    },
    ...pick(constants, constantsFile, ['PREF_DEFAULTS']),
  }
})()

async function main() {
  checkTypes()
  const manifests = manifestReader.readManifests()
  checkManifests(manifests)
  const sheets = styleFiles(manifests)

  // Every brand mark, as the data URI the token sheet declares (D38). Nothing
  // is written yet: a refusal anywhere in this build must leave lib/ as it was.
  const images = planBrandMarks({ brandDir: BRAND_ASSETS })

  const tokenDoc = loadTokens(SRC)
  const cssText = buildStylesheet({ sheets, srcDir: SRC, tokenDoc, gates: CONSTANTS.gates, images })

  const generated = generatedModule({
    STYLESHEET: cssText,
    // The build id: a hash of the bundle itself, written into it below. The
    // skin puts it on <body data-dsh-claude-shell>, so a live page can be
    // matched to the lib/client.js it runs — a hot reload swaps the bundle
    // without reloading the page, so the page's load time says nothing about
    // its code.
    BUILD_ID: BUILD_ID_SLOT,
    // The version this client bundle reports wherever the host asks a client
    // for its build: the account Remote carries it on every call.
    CLIENT_VERSION: PACKAGE.version,
  })

  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'entry.ts')],
    // The metafile keys its inputs by this directory: the module list below is
    // compared against paths relative to the repository root, so the answer
    // must not depend on the shell's own working directory.
    absWorkingDir: ROOT,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'esnext',
    charset: 'utf8',
    minify: true,
    sourcemap: 'linked',
    outfile: OUT,
    write: false,
    metafile: true,
    logLevel: 'silent',
    external: HOST_PACKAGES,
    // The factory around the body is part of the output, so the source map
    // counts its lines.
    banner: { js: FACTORY_OPEN },
    footer: { js: FACTORY_CLOSE },
    plugins: [featuresModule(manifests), generated],
  })
  checkCycles(result.metafile)
  // The metafile keys paths the way esbuild saw them: repository-relative.
  const prefix = `${path.relative(ROOT, SRC).split(path.sep).join('/')}/`
  const bundled = new Set(Object.keys(result.metafile.inputs)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length)))
  checkListed(bundled, sheets)

  const output = (suffix) => result.outputFiles.find((file) => file.path.endsWith(suffix)).text
  const draft = output('client.js')
  const sourceMap = output('client.js.map')
  // The slot and the id have the same length, so the source map's columns hold.
  const buildId = createHash('sha256').update(draft).digest('hex').slice(0, BUILD_ID_SLOT.length)
  if (draft.split(BUILD_ID_SLOT).length !== 2) throw new Error('build: the bundle does not carry the build id slot exactly once')
  const bundle = draft.replace(BUILD_ID_SLOT, buildId)

  // Syntax gate: the bundle must parse before it is written. The failing
  // bundle is kept in .debug/ so the line the parser names can be read.
  try {
    new vm.Script(bundle, { filename: 'lib/client.js' })
  } catch (error) {
    fs.mkdirSync(path.join(ROOT, '.debug'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, '.debug', 'failed-bundle.js'), bundle)
    throw new Error(`build: generated bundle failed to parse (written to .debug/failed-bundle.js): ${error.message}`)
  }

  // Everything is validated before anything is written: a refusal anywhere in
  // this build must not leave lib/ holding one half of a new build beside the
  // other half of the previous one. lib/ is not in version control (D47), so a
  // fresh clone has no directory to write into yet.
  const copy = JSON.parse(fs.readFileSync(path.join(DATA, MODEL_COPY), 'utf8'))
  const copyKeys = validateModelCopy(copy)
  const copyText = JSON.stringify(copy, null, 2) + '\n'
  const iconSource = path.join(BRAND_ASSETS, ICON_SOURCE)
  const iconTarget = path.join(LIB, ICON_FILE)
  if (!fs.existsSync(iconSource)) throw new Error(`build: packages/assets/src/brand/${ICON_SOURCE} is missing`)

  fs.mkdirSync(LIB, { recursive: true })
  fs.writeFileSync(OUT, bundle)
  fs.writeFileSync(`${OUT}.map`, sourceMap)
  console.log(`built lib/client.js (${Buffer.byteLength(bundle)} bytes, build ${buildId}) from packages/client/src/ (${bundled.size} modules + ${sheets.length} stylesheets + ${Object.keys(images).length} brand marks)`)

  fs.writeFileSync(path.join(LIB, MODEL_COPY), copyText)
  console.log(`built lib/${MODEL_COPY} (${copyKeys} copy keys)`)

  fs.copyFileSync(iconSource, iconTarget)
  console.log(`built lib/${ICON_FILE} (${fs.statSync(iconTarget).size} bytes) from packages/assets/src/brand/${ICON_SOURCE}`)

  const fonts = buildFonts({ assetsDir: ASSETS, libDir: LIB })
  console.log(`built lib/fonts/ (${fonts.files} files, ${fonts.bytes} bytes) from packages/assets/src/fonts/`)

  const host = await buildHostHalf({ outDir: LIB })
  console.log(`built lib/host/ (${host.files} modules) from packages/host/src/`)
}

await main()
