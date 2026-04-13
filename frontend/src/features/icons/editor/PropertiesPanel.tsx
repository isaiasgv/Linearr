import type { Composition, Layer, TextLayer, ImageLayer } from './types'
import { FONTS } from './fonts'

interface Props {
  composition: Composition
  selectedId: string | null
  onChange: (comp: Composition) => void
}

const inputClass =
  'w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500'

const labelClass = 'text-[10px] uppercase text-slate-500 font-medium tracking-wide'

export function PropertiesPanel({ composition, selectedId, onChange }: Props) {
  const selected = composition.layers.find((l) => l.id === selectedId) ?? null

  const update = (patch: Partial<Layer>) => {
    if (!selected) return
    onChange({
      ...composition,
      layers: composition.layers.map((l) =>
        l.id === selected.id ? ({ ...l, ...patch } as Layer) : l,
      ),
    })
  }

  if (!selected) {
    return (
      <div className="p-4 text-xs text-slate-500 text-center">
        Select a layer to edit its properties.
      </div>
    )
  }

  if (selected.kind === 'text') {
    const layer = selected as TextLayer
    return (
      <div className="p-3 space-y-3 overflow-y-auto">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Text Layer</h3>
        <div>
          <label className={labelClass}>Text</label>
          <textarea
            value={layer.text}
            onChange={(e) => update({ text: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Font</label>
          <select
            value={layer.font}
            onChange={(e) => update({ font: e.target.value })}
            className={inputClass}
          >
            {FONTS.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Size</label>
            <input
              type="number"
              value={layer.size}
              onChange={(e) => update({ size: parseInt(e.target.value) || 16 })}
              min={16}
              max={400}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Weight</label>
            <select
              value={layer.weight}
              onChange={(e) => update({ weight: parseInt(e.target.value) })}
              className={inputClass}
            >
              {[100, 300, 400, 500, 700, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Color</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={layer.color}
              onChange={(e) => update({ color: e.target.value })}
              className="w-8 h-8 bg-transparent border border-slate-700 rounded cursor-pointer"
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
          <label className={labelClass}>Letter Spacing</label>
          <input
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
          <label className={labelClass}>Rotation</label>
          <input
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
          className="w-full h-24 object-contain bg-slate-900 border border-slate-700 rounded"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Width</label>
          <input
            type="number"
            value={Math.round(layer.width)}
            onChange={(e) => update({ width: parseInt(e.target.value) || 50 })}
            min={20}
            max={512}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Height</label>
          <input
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
        <label className={labelClass}>Tint Color</label>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={layer.tint || '#ffffff'}
            onChange={(e) => update({ tint: e.target.value })}
            className="w-8 h-8 bg-transparent border border-slate-700 rounded cursor-pointer"
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
        <label className={labelClass}>Opacity</label>
        <input
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
        <label className={labelClass}>Rotation</label>
        <input
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
