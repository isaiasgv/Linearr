/**
 * Font registry for the icon editor.
 *
 * Every non-system font here is **self-hosted** (`public/fonts/`, declared in
 * `src/fonts.css`), not fetched from Google. It used to be, and never worked in the deployed
 * app: the CSP is `default-src 'self'` with `style-src 'self' 'unsafe-inline'`
 * and `connect-src 'self'`, which blocks the stylesheet link, the woff2 files
 * and the inlining fetch alike. Text fell back to `cursive` — Comic Sans on
 * Windows — in both the canvas preview and the exported PNG. Only `npm run dev`
 * looked right, because Vite's dev server does not send that CSP.
 *
 * Two consequences worth keeping in mind when adding a font:
 *
 * 1. Add the face to `src/fonts.css` and the woff2 to `public/fonts/`, and list
 *    it in `FONT_FILES` below. A bare name here with no @font-face resolves to
 *    the fallback silently — no error, just the wrong letterforms.
 * 2. Declare the weights the file actually contains. A browser asked for a
 *    weight a font does not have will *synthesize* one — faux bold, which looks
 *    subtly wrong and is why "Baloo Thambi at 500" never matched the design.
 */

export interface FontDef {
  name: string
  family: string // CSS font-family value
  /** True when the face ships with the app rather than coming from the system. */
  bundled?: boolean
  /**
   * The weights this family can actually render. A variable font lists every
   * step it supports; a static one-weight font lists exactly one.
   * Omitted for system fonts, where the answer depends on the machine.
   */
  weights?: number[]
}

/** Every weight a variable Baloo Thambi 2 covers, and what the UI offers. */
const BALOO_2_WEIGHTS = [400, 500, 600, 700, 800]
const INTER_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

export const FONTS: FontDef[] = [
  { name: 'Inter', family: 'Inter, sans-serif', bundled: true, weights: INTER_WEIGHTS },
  { name: 'Bebas Neue', family: '"Bebas Neue", sans-serif', bundled: true, weights: [400] },
  // v1 of the family. Static and single-weight — see the note above.
  { name: 'Baloo Thambi', family: '"Baloo Thambi", cursive', bundled: true, weights: [400] },
  {
    name: 'Baloo Thambi 2',
    family: '"Baloo Thambi 2", cursive',
    bundled: true,
    weights: BALOO_2_WEIGHTS,
  },
  { name: 'Impact', family: 'Impact, "Arial Black", sans-serif' },
  { name: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { name: 'Helvetica', family: 'Helvetica, Arial, sans-serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Courier New', family: '"Courier New", monospace' },
  { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
  { name: 'Verdana', family: 'Verdana, sans-serif' },
  { name: 'Palatino', family: '"Palatino Linotype", serif' },
  { name: 'Garamond', family: 'Garamond, serif' },
  { name: 'Comic Sans MS', family: '"Comic Sans MS", cursive' },
]

/** Weights offered for a font, falling back to the common system range. */
const SYSTEM_WEIGHTS = [300, 400, 500, 700, 900]

export function weightsFor(fontName: string): number[] {
  return FONTS.find((f) => f.name === fontName)?.weights ?? SYSTEM_WEIGHTS
}

/**
 * Snap a weight onto one the font can actually render.
 *
 * Used when switching fonts so a layer never carries a weight the new family
 * would have to fake — picking the nearest real one is both closer to what the
 * user sees and honest about what was chosen.
 */
export function nearestWeight(fontName: string, weight: number): number {
  const available = weightsFor(fontName)
  if (available.includes(weight)) return weight
  return available.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best))
}

/**
 * No-op, kept for call-site compatibility.
 *
 * Bundled faces are declared in `fonts.css`, which is imported once at startup,
 * so there is nothing to inject per font any more. It used to append a
 * `<link>` to Google Fonts — the thing the CSP was blocking.
 */
export function ensureFontLoaded(_fontName: string): void {
  /* bundled: nothing to do */
}

export function familyFor(fontName: string): string {
  return FONTS.find((f) => f.name === fontName)?.family ?? fontName
}

// ── Font embedding for SVG export ──────────────────────────────────────────

/**
 * Served from `public/fonts/`, so these are same-origin absolute paths —
 * fetchable under `connect-src 'self'`, and available with no network at all.
 *
 * They live in `public/` rather than `src/assets/` deliberately: Tailwind v4
 * inlines `@import`ed CSS into `index.css` WITHOUT rebasing relative `url()`s,
 * so a `./x.woff2` written next to the stylesheet came out pointing at
 * `/assets/x.woff2` while the emitted file was content-hashed. The build
 * succeeded and every font 404'd at runtime. Absolute paths cannot drift that
 * way. The same paths back the CSS in `src/fonts.css`; keep the two in step.
 */
const FONT_FILES: Record<string, string[]> = {
  Inter: ['/fonts/inter-latin.woff2', '/fonts/inter-latin-ext.woff2'],
  'Bebas Neue': ['/fonts/bebas-neue-latin.woff2', '/fonts/bebas-neue-latin-ext.woff2'],
  'Baloo Thambi': ['/fonts/baloo-thambi-latin.woff2', '/fonts/baloo-thambi-latin-ext.woff2'],
  'Baloo Thambi 2': ['/fonts/baloo-thambi-2-latin.woff2', '/fonts/baloo-thambi-2-latin-ext.woff2'],
}

const fontDataCache = new Map<string, string | null>()

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a
  // 90 KB font and throws RangeError.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * A `@font-face` block with the font bytes inlined as a data URI.
 *
 * Required for export, not merely nice: `rasterizeToPng` draws the SVG through
 * an `<img>`, and an SVG loaded that way is not allowed to fetch anything —
 * external font references simply do not resolve, so the canvas would rasterize
 * the fallback face no matter how correct the on-screen preview looked.
 *
 * The weight range is emitted as the declared range so a variable font keeps
 * every weight after inlining.
 */
export async function getEmbeddableFontFace(fontName: string): Promise<string | null> {
  const cached = fontDataCache.get(fontName)
  if (cached !== undefined) return cached

  const files = FONT_FILES[fontName]
  if (!files) {
    fontDataCache.set(fontName, null)
    return null
  }

  const weights = weightsFor(fontName)
  const range =
    weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : String(weights[0] ?? 400)

  try {
    const blocks: string[] = []
    for (const url of files) {
      const res = await fetch(url)
      if (!res.ok) continue
      const b64 = toBase64(await res.arrayBuffer())
      blocks.push(
        `@font-face{font-family:'${fontName}';font-style:normal;` +
          `font-weight:${range};src:url(data:font/woff2;base64,${b64}) format('woff2');}`,
      )
    }
    const result = blocks.length > 0 ? blocks.join('\n') : null
    fontDataCache.set(fontName, result)
    return result
  } catch {
    fontDataCache.set(fontName, null)
    return null
  }
}

/** Collect the bundled font names used in a composition's text layers. */
export function getUsedGoogleFonts(layers: Array<{ kind: string; font?: string }>): string[] {
  const names = new Set<string>()
  for (const l of layers) {
    if (l.kind === 'text' && l.font && FONT_FILES[l.font]) names.add(l.font)
  }
  return [...names]
}
