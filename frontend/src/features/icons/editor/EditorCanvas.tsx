import { useEffect, useRef, useState } from 'react'
import type { Composition, Layer, ImageLayer, TextLayer } from './types'
import { CANVAS_SIZE } from './types'
import { renderSVG } from './render'
import { ensureFontLoaded } from './fonts'

interface Props {
  composition: Composition
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (comp: Composition) => void
}

type DragMode = 'move' | 'resize' | 'rotate' | null

export function EditorCanvas({ composition, selectedId, onSelect, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const dragStartRef = useRef<{
    x: number
    y: number
    layer: Layer | null
  } | null>(null)

  // Preload fonts used in any text layer
  useEffect(() => {
    composition.layers.forEach((l) => {
      if (l.kind === 'text') ensureFontLoaded(l.font)
    })
  }, [composition.layers])

  const selected = composition.layers.find((l) => l.id === selectedId) ?? null

  // Arrow key movement for selected layer
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return
      const step = e.shiftKey ? 10 : 1
      let dx = 0
      let dy = 0

      switch (e.key) {
        case 'ArrowUp':
          dy = -step
          break
        case 'ArrowDown':
          dy = step
          break
        case 'ArrowLeft':
          dx = -step
          break
        case 'ArrowRight':
          dx = step
          break
        default:
          return
      }

      e.preventDefault()
      const layer = composition.layers.find((l) => l.id === selectedId)
      if (!layer) return
      const updated: Layer = { ...layer, x: layer.x + dx, y: layer.y + dy }
      onChange({
        ...composition,
        layers: composition.layers.map((l) => (l.id === selectedId ? updated : l)),
      })
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, composition, onChange])

  // Convert browser pointer coords to SVG coords
  const getSvgPoint = (e: React.PointerEvent | PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE
    return { x, y }
  }

  const handlePointerDownLayer = (e: React.PointerEvent, layer: Layer, mode: DragMode) => {
    e.stopPropagation()
    onSelect(layer.id)
    setDragMode(mode)
    dragStartRef.current = { ...getSvgPoint(e), layer: { ...layer } }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragMode || !dragStartRef.current) return
    const { x, y, layer } = dragStartRef.current
    if (!layer) return
    const cur = getSvgPoint(e)
    const dx = cur.x - x
    const dy = cur.y - y

    if (dragMode === 'move') {
      const updated: Layer = { ...layer, x: layer.x + dx, y: layer.y + dy }
      onChange({
        ...composition,
        layers: composition.layers.map((l) => (l.id === layer.id ? updated : l)),
      })
    } else if (dragMode === 'resize' && layer.kind === 'image') {
      const il = layer as ImageLayer
      const newW = Math.max(20, il.width + dx)
      const newH = Math.max(20, il.height + dy)
      const updated: ImageLayer = { ...il, width: newW, height: newH }
      onChange({
        ...composition,
        layers: composition.layers.map((l) => (l.id === layer.id ? updated : l)),
      })
    } else if (dragMode === 'rotate') {
      const cx = layer.kind === 'image' ? layer.x + (layer as ImageLayer).width / 2 : layer.x
      const cy = layer.kind === 'image' ? layer.y + (layer as ImageLayer).height / 2 : layer.y
      const angle = (Math.atan2(cur.y - cy, cur.x - cx) * 180) / Math.PI + 90
      const updated: Layer = { ...layer, rotation: Math.round(angle) }
      onChange({
        ...composition,
        layers: composition.layers.map((l) => (l.id === layer.id ? updated : l)),
      })
    }
  }

  const handlePointerUp = () => {
    setDragMode(null)
    dragStartRef.current = null
  }

  // Compute selection bounding box
  let bbox: { x: number; y: number; w: number; h: number; rot: number } | null = null
  if (selected) {
    if (selected.kind === 'image') {
      bbox = {
        x: selected.x,
        y: selected.y,
        w: selected.width,
        h: selected.height,
        rot: selected.rotation,
      }
    } else {
      // approximate text bbox
      const tl = selected as TextLayer
      const w = Math.max(80, tl.size * Math.max(2, tl.text.length * 0.6))
      const h = tl.size * 1.2 * (tl.text.split('\n').length || 1)
      bbox = { x: tl.x - w / 2, y: tl.y - h / 2, w, h, rot: tl.rotation }
    }
  }

  // Render the composition as inline SVG for the canvas
  const svgString = renderSVG(composition)

  return (
    <div
      className="flex-1 flex items-center justify-center bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:24px_24px] overflow-auto p-6"
      onClick={() => onSelect(null)}
    >
      {/* tabIndex makes the div focusable so it can receive keyboard events */}
      <div
        ref={wrapperRef}
        className="relative outline-none"
        style={{ width: 480, height: 480 }}
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
          width={480}
          height={480}
          xmlns="http://www.w3.org/2000/svg"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: svgString.replace(/^<svg[^>]*>|<\/svg>$/g, '') }}
        />
        {/* Selection overlay */}
        {bbox && selected && (
          <svg
            viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
            width={480}
            height={480}
            className="absolute inset-0 pointer-events-none"
          >
            <g
              transform={`translate(${bbox.x + bbox.w / 2},${bbox.y + bbox.h / 2}) rotate(${bbox.rot}) translate(${-bbox.w / 2},${-bbox.h / 2})`}
            >
              <rect
                x={0}
                y={0}
                width={bbox.w}
                height={bbox.h}
                fill="transparent"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="6 4"
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onPointerDown={(e) => handlePointerDownLayer(e, selected, 'move')}
              />
              {selected.kind === 'image' && (
                <rect
                  x={bbox.w - 8}
                  y={bbox.h - 8}
                  width={16}
                  height={16}
                  fill="#6366f1"
                  style={{ pointerEvents: 'all', cursor: 'nwse-resize' }}
                  onPointerDown={(e) => handlePointerDownLayer(e, selected, 'resize')}
                />
              )}
              <circle
                cx={bbox.w / 2}
                cy={-30}
                r={8}
                fill="#a855f7"
                style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                onPointerDown={(e) => handlePointerDownLayer(e, selected, 'rotate')}
              />
              <line
                x1={bbox.w / 2}
                y1={0}
                x2={bbox.w / 2}
                y2={-22}
                stroke="#a855f7"
                strokeWidth={2}
              />
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
