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
