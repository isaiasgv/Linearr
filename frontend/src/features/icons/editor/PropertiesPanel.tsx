import { useId, useState, type ReactNode } from 'react'
import type { Composition, Layer, TextLayer, ImageLayer } from './types'
import { CANVAS_PRESETS, MAX_CANVAS, MIN_CANVAS, autoFitLayers, clampCanvas } from './types'
import { FONTS, nearestWeight, weightsFor } from './fonts'

interface Props {
  composition: Composition
  selectedId: string | null
  onChange: (comp: Composition) => void
}

const inputClass =
  'w-full bg-slate-900 border border-slate-700 rounded-sm px-2 py-1 text-xs text-slate-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500'

const labelClass = 'text-[10px] uppercase text-slate-500 font-medium tracking-wide'

/**
 * Canvas dimensions.
 *
 * Resizing does NOT move the layers — that would silently rearrange someone's
 * artwork. Auto-fit is offered right here instead, so re-filling the new canvas
 * stays a deliberate action.
 */
function CanvasPanel({
  composition,
  onChange,
  children,
}: {
  composition: Composition
  onChange: (comp: Composition) => void
  children?: ReactNode
}) {
  const fieldId = useId()
  const [locked, setLocked] = useState(true)
  const ratio = composition.width / composition.height

  function setSize(next: Partial<{ width: number; height: number }>) {
    let width = clampCanvas(next.width ?? composition.width)
    let height = clampCanvas(next.height ?? composition.height)
    if (locked) {
      if (next.width !== undefined) height = clampCanvas(width / ratio)
      else if (next.height !== undefined) width = clampCanvas(height * ratio)
    }
    onChange({ ...composition, width, height })
  }

  const isPreset = (w: number, h: number) => composition.width === w && composition.height === h

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold tracking-wide text-slate-300 uppercase">Canvas</h3>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${fieldId}-w`} className={labelClass}>
            Width
          </label>
          <input
            id={`${fieldId}-w`}
            type="number"
            min={MIN_CANVAS}
            max={MAX_CANVAS}
            value={composition.width}
            onChange={(e) => setSize({ width: Number(e.target.value) })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-h`} className={labelClass}>
            Height
          </label>
          <input
            id={`${fieldId}-h`}
            type="number"
            min={MIN_CANVAS}
            max={MAX_CANVAS}
            value={composition.height}
            onChange={(e) => setSize({ height: Number(e.target.value) })}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => setLocked(e.target.checked)}
          className="h-3.5 w-3.5 accent-indigo-500"
        />
        Lock aspect ratio
      </label>

      <div className="flex flex-wrap gap-1">
        {CANVAS_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ ...composition, width: p.width, height: p.height })}
            aria-pressed={isPreset(p.width, p.height)}
            className={`rounded-sm px-2 py-1 text-[11px] transition-colors ${
              isPreset(p.width, p.height)
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {composition.layers.length > 0 && (
        <button
          type="button"
          onClick={() => onChange(autoFitLayers(composition))}
          className="w-full rounded-sm bg-slate-800 px-2 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700"
        >
          Re-fit layers to canvas
        </button>
      )}

      {children && <div className="border-t border-slate-800 pt-3">{children}</div>}
    </div>
  )
}

export function PropertiesPanel({ composition, selectedId, onChange }: Props) {
  const selected = composition.layers.find((l) => l.id === selectedId) ?? null
  const fieldId = useId()
  const ids = {
    text: `${fieldId}-text`,
    font: `${fieldId}-font`,
    size: `${fieldId}-size`,
    weight: `${fieldId}-weight`,
    color: `${fieldId}-color`,
    letterSpacing: `${fieldId}-letterspacing`,
    rotation: `${fieldId}-rotation`,
    width: `${fieldId}-width`,
    height: `${fieldId}-height`,
    tint: `${fieldId}-tint`,
    opacity: `${fieldId}-opacity`,
  }

  const update = (patch: Partial<Layer>) => {
    if (!selected) return
    onChange({
      ...composition,
      layers: composition.layers.map((l) =>
        l.id === selected.id ? ({ ...l, ...patch } as Layer) : l,
      ),
    })
  }

  // With nothing selected this used to be a dead end reading "select a layer".
  // The canvas itself has no other home, and it is the one property that always
  // applies, so it lives here.
  if (!selected) {
    return (
      <CanvasPanel composition={composition} onChange={onChange}>
        <p className="text-center text-xs text-slate-500">Select a layer to edit its properties.</p>
      </CanvasPanel>
    )
  }

  if (selected.kind === 'text') {
    const layer = selected as TextLayer
    const layerWeights = weightsFor(layer.font)
    return (
      <div className="p-3 space-y-3 overflow-y-auto">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Text Layer</h3>
        <div>
          <label htmlFor={ids.text} className={labelClass}>
            Text
          </label>
          <textarea
            id={ids.text}
            value={layer.text}
            onChange={(e) => update({ text: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={ids.font} className={labelClass}>
            Font
          </label>
          <select
            id={ids.font}
            value={layer.font}
            onChange={(e) =>
              // Snap the weight too: a family that lacks the current weight
              // would have the browser synthesize one, which is why "Baloo
              // Thambi at 500" never matched the intended design.
              update({
                font: e.target.value,
                weight: nearestWeight(e.target.value, layer.weight),
              })
            }
            className={inputClass}
          >
            {FONTS.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.weights?.length === 1 ? ' (one weight)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={ids.size} className={labelClass}>
              Size
            </label>
            <input
              id={ids.size}
              type="number"
              value={layer.size}
              onChange={(e) => update({ size: parseInt(e.target.value) || 16 })}
              min={16}
              max={400}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={ids.weight} className={labelClass}>
              Weight
            </label>
            <select
              id={ids.weight}
              value={layer.weight}
              onChange={(e) => update({ weight: parseInt(e.target.value) })}
              disabled={layerWeights.length === 1}
              title={
                layerWeights.length === 1
                  ? `${layer.font} ships a single weight (${layerWeights[0]})`
                  : undefined
              }
              className={inputClass}
            >
              {layerWeights.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={ids.color} className={labelClass}>
            Color
          </label>
          <div className="flex gap-2 items-center">
            <input
              id={ids.color}
              type="color"
              value={layer.color}
              onChange={(e) => update({ color: e.target.value })}
              className="w-8 h-8 bg-transparent border border-slate-700 rounded-sm cursor-pointer"
            />
            <input
              type="text"
              value={layer.color}
              onChange={(e) => update({ color: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor={ids.letterSpacing} className={labelClass}>
            Letter Spacing
          </label>
          <input
            id={ids.letterSpacing}
            type="range"
            min={-10}
            max={50}
            value={layer.letterSpacing ?? 0}
            onChange={(e) => update({ letterSpacing: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>
        <div>
          <label className={labelClass}>Align</label>
          <div className="flex gap-1">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                onClick={() => update({ align: a })}
                className={`flex-1 px-2 py-1 text-xs rounded ${
                  layer.align === a
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor={ids.rotation} className={labelClass}>
            Rotation
          </label>
          <input
            id={ids.rotation}
            type="range"
            min={-180}
            max={180}
            value={layer.rotation}
            onChange={(e) => update({ rotation: parseInt(e.target.value) })}
            className="w-full"
          />
          <p className="text-[10px] text-slate-500 text-right">{layer.rotation}°</p>
        </div>
      </div>
    )
  }

  // Image layer
  const layer = selected as ImageLayer
  return (
    <div className="p-3 space-y-3 overflow-y-auto">
      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
        Image Layer ({layer.format.toUpperCase()})
      </h3>
      <div>
        <img
          src={layer.src}
          alt=""
          className="w-full h-24 object-contain bg-slate-900 border border-slate-700 rounded-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={ids.width} className={labelClass}>
            Width
          </label>
          <input
            id={ids.width}
            type="number"
            value={Math.round(layer.width)}
            onChange={(e) => update({ width: parseInt(e.target.value) || 50 })}
            min={20}
            max={512}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={ids.height} className={labelClass}>
            Height
          </label>
          <input
            id={ids.height}
            type="number"
            value={Math.round(layer.height)}
            onChange={(e) => update({ height: parseInt(e.target.value) || 50 })}
            min={20}
            max={512}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor={ids.tint} className={labelClass}>
          Tint Color
        </label>
        <div className="flex gap-2 items-center">
          <input
            id={ids.tint}
            type="color"
            value={layer.tint || '#ffffff'}
            onChange={(e) => update({ tint: e.target.value })}
            className="w-8 h-8 bg-transparent border border-slate-700 rounded-sm cursor-pointer"
          />
          <input
            type="text"
            value={layer.tint || ''}
            onChange={(e) => update({ tint: e.target.value || null })}
            placeholder="#ffffff or empty"
            className={inputClass}
          />
          <button
            onClick={() => update({ tint: null })}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Clear
          </button>
        </div>
      </div>
      <div>
        <label htmlFor={ids.opacity} className={labelClass}>
          Opacity
        </label>
        <input
          id={ids.opacity}
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => update({ opacity: parseInt(e.target.value) / 100 })}
          className="w-full"
        />
        <p className="text-[10px] text-slate-500 text-right">{Math.round(layer.opacity * 100)}%</p>
      </div>
      <div>
        <label htmlFor={ids.rotation} className={labelClass}>
          Rotation
        </label>
        <input
          id={ids.rotation}
          type="range"
          min={-180}
          max={180}
          value={layer.rotation}
          onChange={(e) => update({ rotation: parseInt(e.target.value) })}
          className="w-full"
        />
        <p className="text-[10px] text-slate-500 text-right">{layer.rotation}°</p>
      </div>
    </div>
  )
}
