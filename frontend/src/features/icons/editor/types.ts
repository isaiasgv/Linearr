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
  size: number // always 512
}

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

export function newId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export function defaultComposition(): Composition {
  return {
    layers: [],
    background: { type: 'transparent', value: '' },
    size: CANVAS_SIZE,
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

/** Auto-fit all layers to maximize use of canvas space */
export function autoFitLayers(comp: Composition): Composition {
  const visible = comp.layers.filter((l) => l.visible !== false)
  if (visible.length === 0) return comp

  const margin = CANVAS_SIZE * 0.05
  const usable = CANVAS_SIZE - margin * 2

  if (visible.length === 1) {
    const layer = visible[0]
    if (layer.kind === 'text') {
      const charWidth = Math.max(layer.text.length, 1) * 0.6
      const fitSize = Math.min(usable / charWidth, usable * 0.8)
      const updated: TextLayer = {
        ...layer,
        size: Math.round(fitSize),
        x: CANVAS_SIZE / 2,
        y: CANVAS_SIZE / 2,
        rotation: 0,
      }
      return { ...comp, layers: comp.layers.map((l) => (l.id === layer.id ? updated : l)) }
    }
    if (layer.kind === 'image') {
      const updated: ImageLayer = {
        ...layer,
        x: margin,
        y: margin,
        width: usable,
        height: usable,
        rotation: 0,
      }
      return { ...comp, layers: comp.layers.map((l) => (l.id === layer.id ? updated : l)) }
    }
  }

  // Multiple layers: stack vertically, distribute space
  const slotH = usable / visible.length
  const updated = comp.layers.map((layer) => {
    const idx = visible.findIndex((v) => v.id === layer.id)
    if (idx === -1) return layer
    const centerY = margin + slotH * idx + slotH / 2

    if (layer.kind === 'text') {
      const charWidth = Math.max(layer.text.length, 1) * 0.6
      const fitSize = Math.min(usable / charWidth, slotH * 0.75)
      return { ...layer, size: Math.round(fitSize), x: CANVAS_SIZE / 2, y: centerY, rotation: 0 }
    }
    if (layer.kind === 'image') {
      const fitW = Math.min(usable, slotH * 0.85)
      const fitH = slotH * 0.85
      return {
        ...layer,
        x: (CANVAS_SIZE - fitW) / 2,
        y: centerY - fitH / 2,
        width: fitW,
        height: fitH,
        rotation: 0,
      }
    }
    return layer
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
