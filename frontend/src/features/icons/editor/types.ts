// Layer-based icon composition types

export type TextLayer = {
  id: string
  kind: 'text'
  text: string
  font: string
  size: number
  weight: number
  color: string
  x: number
  y: number
  rotation: number
  letterSpacing?: number
  align?: 'left' | 'center' | 'right'
  visible?: boolean
}

export type ImageLayer = {
  id: string
  kind: 'image'
  src: string // data URL
  format: 'png' | 'svg'
  tint: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible?: boolean
}

export type Layer = TextLayer | ImageLayer

export type Background = {
  type: 'transparent' | 'solid' | 'gradient'
  value: string // for solid: "#hex". For gradient: "angle|color1|color2"
}

export type Composition = {
  layers: Layer[]
  background: Background
  width: number
  height: number
}

/**
 * A composition as it may exist on disk.
 *
 * Compositions are persisted as JSON in the `saved_icons` table, and every row
 * written before the canvas became resizable has a single square `size` and no
 * `width`/`height`. Read through {@link normalizeComposition}, never directly.
 */
export type StoredComposition = Partial<Composition> & { size?: number }

export type ColorMode =
  | 'original'
  | 'all-black'
  | 'all-white'
  | 'text-white-image-original'
  | 'custom'

export type CustomColors = {
  text?: string
  image?: string
  background?: string
}

export const CANVAS_SIZE = 512

/** Bounds for a hand-entered canvas dimension. */
export const MIN_CANVAS = 64
export const MAX_CANVAS = 4096

export const CANVAS_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '512 × 512', width: 512, height: 512 },
  { label: '1024 × 1024', width: 1024, height: 1024 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
]

export function clampCanvas(n: number): number {
  if (!Number.isFinite(n)) return CANVAS_SIZE
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(n)))
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export function defaultComposition(): Composition {
  return {
    layers: [],
    background: { type: 'transparent', value: '' },
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  }
}

/**
 * Read a stored composition into the current shape.
 *
 * Legacy rows carry a single square `size`; new ones carry `width`/`height`.
 * Nothing rewrites the stored rows — every read passes through here instead, so
 * an old project keeps working and is upgraded the next time it is saved.
 */
export function normalizeComposition(raw: unknown): Composition {
  const base = defaultComposition()
  if (!raw || typeof raw !== 'object') return base
  const c = raw as StoredComposition
  const legacy = typeof c.size === 'number' ? clampCanvas(c.size) : null
  return {
    layers: Array.isArray(c.layers) ? c.layers : base.layers,
    background: c.background ?? base.background,
    width: clampCanvas(c.width ?? legacy ?? base.width),
    height: clampCanvas(c.height ?? legacy ?? base.height),
  }
}

export function newTextLayer(text = 'Text'): TextLayer {
  return {
    id: newId(),
    kind: 'text',
    text,
    font: 'Inter',
    size: 96,
    weight: 700,
    color: '#ffffff',
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    rotation: 0,
    letterSpacing: 0,
    align: 'center',
    visible: true,
  }
}

export function newTextLayer500(text = 'Galaxy'): TextLayer {
  return {
    ...newTextLayer(text),
    weight: 500,
    size: 96,
    y: CANVAS_SIZE * 0.38,
  }
}

export function newTextLayer400(text = 'Channel'): TextLayer {
  return {
    ...newTextLayer(text),
    weight: 400,
    size: 72,
    y: CANVAS_SIZE * 0.6,
  }
}

/** Fraction of each side left empty by auto-fit. */
const FIT_MARGIN = 0.05

/**
 * Measure a text layer's widest line, in composition units.
 *
 * The old estimate was `text.length * 0.6 * fontSize`, which is why auto-fitted
 * icons never reached the edges: it runs wide for most strings, so the fitted
 * size came out small and the artwork floated in the middle of the canvas.
 * A real canvas measurement is exact.
 *
 * Returns null when there is no 2D context (SSR, or a test environment with no
 * DOM); callers fall back to the old estimate rather than dividing by zero.
 */
let _measureCtx: CanvasRenderingContext2D | null | undefined
function measureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx !== undefined) return _measureCtx
  try {
    _measureCtx = document.createElement('canvas').getContext('2d')
  } catch {
    _measureCtx = null
  }
  return _measureCtx
}

/**
 * Width of the widest line at font size 1, so callers can scale linearly.
 * Text metrics are proportional to font size, which makes one measurement
 * enough to solve for the size that exactly fills a target width.
 */
export function measureTextUnitWidth(layer: TextLayer): number {
  const lines = layer.text.split('\n')
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '')
  if (!longest) return 0.0001
  const ctx = measureCtx()
  if (!ctx) return Math.max(longest.length, 1) * 0.6
  const REF = 100
  ctx.font = `${layer.weight} ${REF}px ${familyForMeasure(layer.font)}`
  const w = ctx.measureText(longest).width / REF
  // A zero here means the font produced no metrics at all; fall back rather
  // than scale by infinity.
  return w > 0 ? w : Math.max(longest.length, 1) * 0.6
}

/** Kept local to avoid a cycle with fonts.ts, which imports nothing from here. */
function familyForMeasure(font: string): string {
  return `"${font}", sans-serif`
}

function fitTextSize(layer: TextLayer, maxWidth: number, maxHeight: number): number {
  const unitWidth = measureTextUnitWidth(layer)
  const lineCount = layer.text.split('\n').length || 1
  const byWidth = maxWidth / unitWidth
  // 1.1 line height, and the glyph box is a little under the em box.
  const byHeight = maxHeight / (lineCount * 1.1)
  return Math.max(8, Math.round(Math.min(byWidth, byHeight)))
}

/**
 * Auto-fit all layers to fill the canvas, leaving a 5% margin on each side.
 *
 * A single layer is centred and scaled to the margins. Several layers are
 * stacked vertically in equal rows — which is what the house two-line icon
 * wants — with each text line scaled to whichever of its row's width or height
 * budget binds first.
 */
export function autoFitLayers(comp: Composition): Composition {
  const visible = comp.layers.filter((l) => l.visible !== false)
  if (visible.length === 0) return comp

  const marginX = comp.width * FIT_MARGIN
  const marginY = comp.height * FIT_MARGIN
  const usableW = comp.width - marginX * 2
  const usableH = comp.height - marginY * 2

  if (visible.length === 1) {
    const layer = visible[0]
    if (layer.kind === 'text') {
      const updated: TextLayer = {
        ...layer,
        size: fitTextSize(layer, usableW, usableH),
        x: comp.width / 2,
        y: comp.height / 2,
        rotation: 0,
      }
      return { ...comp, layers: comp.layers.map((l) => (l.id === layer.id ? updated : l)) }
    }
    const updated: ImageLayer = {
      ...layer,
      x: marginX,
      y: marginY,
      width: usableW,
      height: usableH,
      rotation: 0,
    }
    return { ...comp, layers: comp.layers.map((l) => (l.id === layer.id ? updated : l)) }
  }

  // Multiple layers: stack vertically, one equal row each.
  const slotH = usableH / visible.length
  const updated = comp.layers.map((layer) => {
    const idx = visible.findIndex((v) => v.id === layer.id)
    if (idx === -1) return layer
    const centerY = marginY + slotH * idx + slotH / 2

    if (layer.kind === 'text') {
      return {
        ...layer,
        size: fitTextSize(layer, usableW, slotH),
        x: comp.width / 2,
        y: centerY,
        rotation: 0,
      }
    }
    const fitH = slotH * 0.85
    const fitW = Math.min(usableW, fitH)
    return {
      ...layer,
      x: (comp.width - fitW) / 2,
      y: centerY - fitH / 2,
      width: fitW,
      height: fitH,
      rotation: 0,
    }
  })

  return { ...comp, layers: updated }
}

export function newImageLayer(src: string, format: 'png' | 'svg'): ImageLayer {
  return {
    id: newId(),
    kind: 'image',
    src,
    format,
    tint: null,
    x: CANVAS_SIZE / 2 - 128,
    y: CANVAS_SIZE / 2 - 128,
    width: 256,
    height: 256,
    rotation: 0,
    opacity: 1,
    visible: true,
  }
}
