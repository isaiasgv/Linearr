// SVG rendering, color modes, and PNG rasterization.

import type { Composition, Layer, ColorMode, CustomColors, TextLayer, ImageLayer } from './types'
import { familyFor } from './fonts'

// ── Color mode application ──────────────────────────────────────────────────

export function applyColorMode(
  comp: Composition,
  mode: ColorMode,
  custom?: CustomColors,
): Composition {
  if (mode === 'original') return comp

  const transparent = mode !== 'custom' || custom?.background === undefined

  return {
    ...comp,
    background:
      mode === 'custom' && custom?.background
        ? { type: 'solid', value: custom.background }
        : transparent
          ? { type: 'transparent', value: '' }
          : comp.background,
    layers: comp.layers.map((layer) => {
      if (layer.kind === 'text') {
        const newColor =
          mode === 'all-black'
            ? '#000000'
            : mode === 'all-white' || mode === 'text-white-image-original'
              ? '#ffffff'
              : mode === 'custom' && custom?.text
                ? custom.text
                : layer.color
        return { ...layer, color: newColor }
      }
      // image layer
      const newTint =
        mode === 'all-black'
          ? '#000000'
          : mode === 'all-white'
            ? '#ffffff'
            : mode === 'text-white-image-original'
              ? layer.tint
              : mode === 'custom' && custom?.image
                ? custom.image
                : layer.tint
      return { ...layer, tint: newTint }
    }),
  }
}

// ── SVG rendering ───────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderBackground(comp: Composition): string {
  const { type, value } = comp.background
  const size = comp.size
  if (type === 'transparent') return ''
  if (type === 'solid') {
    return `<rect width="${size}" height="${size}" fill="${escapeXml(value)}"/>`
  }
  if (type === 'gradient') {
    // value: "angle|color1|color2"
    const [angleStr, c1, c2] = value.split('|')
    const angle = parseFloat(angleStr) || 135
    // Convert angle to x1/y1/x2/y2 (SVG defaults to 0,0 -> 1,0)
    const rad = (angle * Math.PI) / 180
    const x1 = 50 + Math.cos(rad + Math.PI) * 50
    const y1 = 50 + Math.sin(rad + Math.PI) * 50
    const x2 = 50 + Math.cos(rad) * 50
    const y2 = 50 + Math.sin(rad) * 50
    return `<defs><linearGradient id="bg" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0%" stop-color="${escapeXml(c1 || '#6366f1')}"/><stop offset="100%" stop-color="${escapeXml(c2 || '#a855f7')}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#bg)"/>`
  }
  return ''
}

function renderTextLayer(layer: TextLayer): string {
  if (layer.visible === false) return ''
  const family = familyFor(layer.font)
  const lines = layer.text.split('\n')
  const lineHeight = layer.size * 1.1
  const totalHeight = lines.length * lineHeight
  const startY = -totalHeight / 2 + layer.size * 0.85
  const anchor = layer.align === 'left' ? 'start' : layer.align === 'right' ? 'end' : 'middle'

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="0" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('')

  const letterSpacing = layer.letterSpacing ? ` letter-spacing="${layer.letterSpacing}"` : ''
  return `<g transform="translate(${layer.x},${layer.y}) rotate(${layer.rotation})"><text font-family="${escapeXml(family)}" font-size="${layer.size}" font-weight="${layer.weight}" fill="${escapeXml(layer.color)}" text-anchor="${anchor}"${letterSpacing}>${tspans}</text></g>`
}

function renderImageLayer(layer: ImageLayer, idx: number): string {
  if (layer.visible === false) return ''
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2

  // For SVG layers with tint, recolor by replacing fill/stroke
  if (layer.format === 'svg' && layer.tint) {
    try {
      const decoded = decodeURIComponent(escape(atob(layer.src.split(',')[1] || '')))
      const recolored = decoded
        .replace(/fill\s*=\s*"(?!none)[^"]*"/gi, `fill="${layer.tint}"`)
        .replace(/stroke\s*=\s*"(?!none)[^"]*"/gi, `stroke="${layer.tint}"`)
        .replace(/<svg[^>]*>/i, (m) => m.replace(/width="[^"]*"/i, '').replace(/height="[^"]*"/i, ''))
      // Strip outer <svg> and <?xml> so we can embed
      const inner = recolored
        .replace(/<\?xml[^?]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<svg[^>]*>/i, '')
        .replace(/<\/svg>/i, '')
      return `<g transform="translate(${cx},${cy}) rotate(${layer.rotation}) translate(-${layer.width / 2},-${layer.height / 2})" opacity="${layer.opacity}"><svg width="${layer.width}" height="${layer.height}" viewBox="0 0 ${layer.width} ${layer.height}" preserveAspectRatio="xMidYMid meet">${inner}</svg></g>`
    } catch {
      // fall through to plain image
    }
  }

  // PNG with tint via filter
  if (layer.format === 'png' && layer.tint) {
    const filterId = `tint-${idx}`
    const tintHex = layer.tint.replace('#', '')
    const r = parseInt(tintHex.slice(0, 2), 16) / 255
    const g = parseInt(tintHex.slice(2, 4), 16) / 255
    const b = parseInt(tintHex.slice(4, 6), 16) / 255
    return `<defs><filter id="${filterId}"><feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 1 0"/></filter></defs><g transform="translate(${cx},${cy}) rotate(${layer.rotation}) translate(-${layer.width / 2},-${layer.height / 2})" opacity="${layer.opacity}"><image href="${escapeXml(layer.src)}" width="${layer.width}" height="${layer.height}" filter="url(#${filterId})"/></g>`
  }

  // No tint
  return `<g transform="translate(${cx},${cy}) rotate(${layer.rotation}) translate(-${layer.width / 2},-${layer.height / 2})" opacity="${layer.opacity}"><image href="${escapeXml(layer.src)}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid meet"/></g>`
}

export function renderSVG(comp: Composition): string {
  const layers = comp.layers
    .map((l, i) => (l.kind === 'text' ? renderTextLayer(l) : renderImageLayer(l, i)))
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${comp.size}" height="${comp.size}" viewBox="0 0 ${comp.size} ${comp.size}">${renderBackground(comp)}${layers}</svg>`
}

// ── PNG rasterization ───────────────────────────────────────────────────────

export function rasterizeToPng(svgString: string, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Canvas context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

export async function compositionToPngDataUrl(comp: Composition, size = 512): Promise<string> {
  const svg = renderSVG({ ...comp, size })
  const blob = await rasterizeToPng(svg, size)
  return await blobToDataUrl(blob)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// All 5 color modes × {svg, png}
export async function exportAllVariants(comp: Composition, baseName: string) {
  const modes: Array<{ id: ColorMode; label: string }> = [
    { id: 'original', label: 'original' },
    { id: 'all-black', label: 'all-black' },
    { id: 'all-white', label: 'all-white' },
    { id: 'text-white-image-original', label: 'text-white' },
  ]
  for (const m of modes) {
    const recolored = applyColorMode(comp, m.id)
    const svg = renderSVG(recolored)
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}-${m.label}.svg`)
    const png = await rasterizeToPng(svg, comp.size)
    downloadBlob(png, `${baseName}-${m.label}.png`)
  }
}
