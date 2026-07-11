#!/usr/bin/env node
/**
 * Design-system showcase builder.
 *
 * Regenerates the auto-generated FOUNDATIONS block inside showcase.html from the
 * `@theme` token block in ../src/index.css, and compiles the project CSS to
 * ./app.css next to the showcase so the page renders standalone (file://).
 *
 * Only the region between <!-- TOKENS:START --> and <!-- TOKENS:END --> is
 * rewritten. The hand-authored component gallery (<!-- KIT --> region) is never
 * touched — edit it by hand.
 *
 *   node design-system/showcase-build.mjs           # from frontend/
 *   npm run showcase:build
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cssPath = join(here, '..', 'src', 'index.css')
const showcasePath = join(here, 'showcase.html')
const outCssPath = join(here, 'app.css')

// ── 1. Parse the @theme block ────────────────────────────────────────────────
const css = readFileSync(cssPath, 'utf8')
const themeMatch = css.match(/@theme\s*\{([\s\S]*?)\n\}/)
if (!themeMatch) {
  console.error('✗ No @theme block found in', cssPath)
  process.exit(1)
}
const tokens = {}
for (const line of themeMatch[1].split('\n')) {
  const m = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/)
  if (m) tokens[m[1]] = m[2].trim()
}

const colorEntries = Object.entries(tokens)
  .filter(([k]) => k.startsWith('--color-'))
  .map(([k, v]) => [k.replace('--color-', ''), v])
const textEntries = Object.entries(tokens).filter(
  ([k]) => k.startsWith('--text-') && !k.includes('--line-height'),
)

// Group color ramps by family (brand, success, …); singletons kept separate.
const families = {}
const singles = []
for (const [name, val] of colorEntries) {
  const m = name.match(/^([a-z]+(?:-[a-z]+)*)-(\d{2,3})$/)
  if (m) (families[m[1]] ??= []).push([Number(m[2]), name, val])
  else singles.push([name, val])
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const swatch = (name, val) =>
  `<div class="sw"><span class="chip" style="background:${esc(val)}"></span>` +
  `<code>${esc(name)}</code><span class="val">${esc(val)}</span></div>`

let html = '<h2>Colors</h2>\n'
for (const [fam, ramp] of Object.entries(families).sort()) {
  ramp.sort((a, b) => a[0] - b[0])
  html += `<h3>${esc(fam)}</h3>\n<div class="grid">\n`
  html += ramp.map(([, name, val]) => swatch(name, val)).join('\n')
  html += '\n</div>\n'
}
if (singles.length) {
  html += '<h3>standalone</h3>\n<div class="grid">\n'
  html += singles.map(([n, v]) => swatch(n, v)).join('\n')
  html += '\n</div>\n'
}
html += '<h2>Type scale</h2>\n<div class="type">\n'
const remToPx = (v) => (v.endsWith('rem') ? ` / ${parseFloat(v) * 16}px` : '')
html += textEntries
  .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]))
  .map(
    ([n, v]) =>
      `<div class="row" style="font-size:${esc(v)}"><span>${esc(n.replace('--text-', 'text-'))}</span>` +
      `<span class="val">${esc(v)}${remToPx(v)}</span></div>`,
  )
  .join('\n')
html += '\n</div>\n'

const total = colorEntries.length + textEntries.length
const block = `<!-- TOKENS:START -->\n<!-- AUTO-GENERATED from src/index.css @theme — do not edit by hand; run npm run showcase:build -->\n${html}<!-- TOKENS:END -->`

// ── 2. Splice into showcase.html ─────────────────────────────────────────────
if (!existsSync(showcasePath)) {
  console.error('✗ showcase.html missing at', showcasePath)
  process.exit(1)
}
let page = readFileSync(showcasePath, 'utf8')
page = page.replace(/<!-- TOKENS:START -->[\s\S]*?<!-- TOKENS:END -->/, block)
writeFileSync(showcasePath, page)

// ── 3. Compile project CSS next to the showcase (standalone render) ──────────
// Use the already-installed PostCSS + @tailwindcss/postcss (no CLI, offline).
try {
  const { default: postcss } = await import('postcss')
  const { default: tailwind } = await import('@tailwindcss/postcss')
  const result = await postcss([tailwind()]).process(css, { from: cssPath, to: outCssPath })
  writeFileSync(outCssPath, result.css)
  console.log('✓ compiled design-system/app.css')
} catch (e) {
  console.warn('⚠ could not compile app.css:', e?.message ?? e)
}

console.log(`✓ showcase.html Foundations regenerated (${total} tokens)`)
