/**
 * assets.mjs — the brand marks the skin paints and the fonts it serves (D38).
 *
 * Every mark under `packages/assets/src/brand/` is small enough to ride the
 * bundle: the build turns each file into a data URI and the generated token
 * sheet declares it as `--dsh-claude-shell-image-<name>`, so the browser half
 * has no asset route at all. A file whose bytes are not a scalable SVG fails
 * the build, and a file no stylesheet names is still declared, so a mark
 * cannot ship unused by accident.
 *
 * `packages/assets/src/fonts/` stands outside that list: buildFonts copies the
 * faces and the licences the package ships into `lib/fonts/`, where the host
 * half's font route reads them, and Anthropic's own faces sit one directory
 * down, in `anthropic/`, because they never enter the package.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The fonts' directory under packages/assets/src/. */
export const FONT_DIR = 'fonts'
/** The directory inside it for Anthropic's own faces, which the package never carries. */
export const PRIVATE_FONT_DIR = 'anthropic'
/**
 * What `packages/assets/src/fonts/` ships, in the order the build log counts
 * it: the four faces and the three licences plus the authors file, which OFL
 * 1.1 requires to travel with the fonts it covers.
 */
const SHIPPED_FONTS = [
  'JetBrainsMonoVariable.ttf',
  'JetBrainsMonoItalicVariable.ttf',
  'InterVariable.woff2',
  'NotoSerifVariable.woff2',
  'OFL.txt',
  'OFL-Inter.txt',
  'OFL-NotoSerif.txt',
  'AUTHORS.txt',
]

/**
 * Every brand mark, as the custom property the token sheet declares it under
 * and the data URI that carries it.
 *
 * @param options.brandDir - packages/assets/src/brand.
 * @returns `{ <name>: data URI }`, keyed by the file name without its extension.
 */
export function planBrandMarks({ brandDir }) {
  const marks = {}
  for (const file of fs.readdirSync(brandDir).sort()) {
    if (!file.endsWith('.svg')) throw new Error(`build: packages/assets/src/brand/${file} is not an SVG brand mark`)
    const svg = fs.readFileSync(path.join(brandDir, file), 'utf8').replace(/\r\n/g, '\n').trim()
    if (!svg.startsWith('<svg') || !svg.includes('viewBox=')) {
      throw new Error(`build: packages/assets/src/brand/${file} is not a scalable SVG (needs <svg viewBox=…>)`)
    }
    if (/<\/script/i.test(svg)) throw new Error(`build: packages/assets/src/brand/${file} carries a script end tag`)
    marks[path.basename(file, '.svg')] = `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  if (Object.keys(marks).length === 0) throw new Error('build: packages/assets/src/brand/ holds no marks')
  return marks
}

/**
 * Copy the faces the package ships, with the licences and the authors file that
 * OFL 1.1 requires to travel with them, from `packages/assets/src/fonts/` into
 * `<out>/fonts/`, where the host half's font route reads them.
 *
 * The file list is the whole contract for that directory: a name it does not
 * carry ships nothing, and Anthropic's own faces live one directory down in
 * `anthropic/`, out of the package.
 *
 * @param options.assetsDir - the directory the fonts live in.
 * @param options.libDir - the build output directory.
 * @returns `{ files, bytes }` of what was written, for the build log.
 */
export function buildFonts({ assetsDir, libDir }) {
  const source = path.join(assetsDir, FONT_DIR)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== PRIVATE_FONT_DIR) throw new Error(`build: packages/assets/src/${FONT_DIR}/${entry.name}/ is a directory the build does not ship; only ${PRIVATE_FONT_DIR}/ is one`)
      continue
    }
    if (!SHIPPED_FONTS.includes(entry.name)) throw new Error(`build: packages/assets/src/${FONT_DIR}/${entry.name} ships nothing; add it to SHIPPED_FONTS or delete it`)
  }
  const target = path.join(libDir, FONT_DIR)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  let bytes = 0
  for (const name of SHIPPED_FONTS) {
    // The file list was checked against the directory above, so a missing one
    // is a build bug rather than a state a user can reach.
    fs.copyFileSync(path.join(source, name), path.join(target, name))
    bytes += fs.statSync(path.join(target, name)).size
  }
  return { files: SHIPPED_FONTS.length, bytes }
}
