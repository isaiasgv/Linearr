/**
 * Generate a channel icon from a brand line and a channel line.
 *
 * The house style is two stacked lines — `Galaxy` over the channel's own name —
 * in white, on transparent, filling the canvas. That shape was already encoded
 * in `newTextLayer500` / `newTextLayer400` and seeded by the icon editor, but
 * only inside the editor, only when it was opened by hand, and with a crude
 * split of the channel name on whitespace. This is the same idea as one pure
 * function, so the channel form, the channel view and the editor all produce
 * identical output.
 *
 * Every stylistic choice here is a *default*, read from Settings. Nothing about
 * "Galaxy" or Baloo Thambi is hardcoded beyond `FALLBACK_BRAND_DEFAULTS`.
 */
import {
  CANVAS_SIZE,
  autoFitLayers,
  clampCanvas,
  newId,
  type Composition,
  type TextLayer,
} from './editor/types'
import { ensureFontLoaded, nearestWeight } from './editor/fonts'

export interface IconBrandDefaults {
  /** The line above the channel name — a network brand, e.g. "Galaxy". */
  brand_line: string
  brand_font: string
  brand_weight: number
  name_font: string
  name_weight: number
  color: string
  width: number
  height: number
}

/**
 * Used when the server has not answered yet. Mirrors `_ICON_BRAND_DEFAULTS` in
 * `main.py`; the server's copy is authoritative once loaded.
 *
 * `brand_weight` is 400, not 500, because **Baloo Thambi ships exactly one
 * weight**. Asking for 500 does not fail — the browser synthesizes a faux bold,
 * which is close enough to look intentional and wrong enough to never match the
 * design. Baloo Thambi 2 is the variable sibling (400–800) if a heavier brand
 * line is wanted.
 */
export const FALLBACK_BRAND_DEFAULTS: IconBrandDefaults = {
  brand_line: 'Galaxy',
  brand_font: 'Baloo Thambi',
  brand_weight: 400,
  name_font: 'Baloo Thambi 2',
  name_weight: 400,
  color: '#ffffff',
  width: CANVAS_SIZE,
  height: CANVAS_SIZE,
}

function textLayer(
  text: string,
  font: string,
  weight: number,
  color: string,
  y: number,
): TextLayer {
  return {
    id: newId(),
    kind: 'text',
    text,
    font,
    size: 96,
    weight,
    color,
    x: 0,
    y,
    rotation: 0,
    letterSpacing: 0,
    align: 'center',
    visible: true,
  }
}

/**
 * Wait for both faces to be usable before anything measures them.
 *
 * `ensureFontLoaded` only injects the Google Fonts stylesheet — it does not
 * wait. Auto-fit measures glyph widths with a canvas context, and measuring
 * before the face has arrived silently returns metrics for a fallback system
 * font, so the icon is fitted to the wrong width and lands too big or too small.
 * Resolves either way: a font that never loads should still produce an icon.
 */
async function waitForFonts(fonts: string[], sizePx = 96): Promise<void> {
  fonts.forEach(ensureFontLoaded)
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(
    fonts.map((f) => document.fonts.load(`${sizePx}px "${f}"`).catch(() => undefined)),
  )
  await document.fonts.ready.catch(() => undefined)
}

/**
 * Build the composition. Async only because of the font wait above.
 *
 * Either line may be blank — a channel whose brand line is cleared gets a
 * single centred line, which auto-fit then scales to the whole canvas.
 */
export async function generateIconComposition(
  brandLine: string,
  channelLine: string,
  d: IconBrandDefaults = FALLBACK_BRAND_DEFAULTS,
): Promise<Composition> {
  const width = clampCanvas(d.width)
  const height = clampCanvas(d.height)
  await waitForFonts([d.brand_font, d.name_font])

  const layers: TextLayer[] = []
  const brand = brandLine.trim()
  const name = channelLine.trim()
  // Snap to a weight the family actually has. A config stored before the font
  // registry knew about real weights can still carry an impossible one, and a
  // synthesized weight is exactly the mismatch this is here to prevent.
  const brandWeight = nearestWeight(d.brand_font, d.brand_weight)
  const nameWeight = nearestWeight(d.name_font, d.name_weight)
  if (brand) layers.push(textLayer(brand, d.brand_font, brandWeight, d.color, height * 0.38))
  if (name) layers.push(textLayer(name, d.name_font, nameWeight, d.color, height * 0.62))

  const comp: Composition = {
    layers,
    background: { type: 'transparent', value: '' },
    width,
    height,
  }
  // Auto-fit is what makes the artwork reach the edges rather than sitting in a
  // small block in the middle — it measures the real glyph widths and scales
  // each line until it hits the 5% margin.
  return layers.length > 0 ? (autoFitLayers(comp) as Composition) : comp
}

/**
 * Split a channel name into the two lines, respecting the configured brand.
 *
 * "Galaxy Cartoons" with a brand of "Galaxy" should not produce "Galaxy" over
 * "Galaxy Cartoons" — the brand is already there, so it is peeled off and the
 * remainder becomes the channel line.
 */
export function splitChannelName(
  name: string,
  brand: string,
): { brandLine: string; channelLine: string } {
  const trimmed = (name ?? '').trim()
  const b = (brand ?? '').trim()
  if (b && trimmed.toLowerCase().startsWith(b.toLowerCase())) {
    const rest = trimmed.slice(b.length).trim()
    if (rest) return { brandLine: b, channelLine: rest }
  }
  return { brandLine: b, channelLine: trimmed }
}
