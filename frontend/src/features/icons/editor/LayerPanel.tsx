import type { Composition, Layer } from './types'
import { newTextLayer, newImageLayer } from './types'

interface Props {
  composition: Composition
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (comp: Composition) => void
}

export function LayerPanel({ composition, selectedId, onSelect, onChange }: Props) {
  const addText = () => {
    const layer = newTextLayer('Text')
    onChange({ ...composition, layers: [...composition.layers, layer] })
    onSelect(layer.id)
  }

  const addImage = (accept: string, format: 'png' | 'svg') => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const layer = newImageLayer(reader.result as string, format)
        onChange({ ...composition, layers: [...composition.layers, layer] })
        onSelect(layer.id)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const removeLayer = (id: string) => {
    onChange({ ...composition, layers: composition.layers.filter((l) => l.id !== id) })
    if (selectedId === id) onSelect(null)
  }

  const toggleVisible = (id: string) => {
    onChange({
      ...composition,
      layers: composition.layers.map((l) =>
        l.id === id ? ({ ...l, visible: l.visible === false ? true : false } as Layer) : l,
      ),
    })
  }

  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = composition.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= composition.layers.length) return
    const layers = [...composition.layers]
    ;[layers[idx], layers[newIdx]] = [layers[newIdx], layers[idx]]
    onChange({ ...composition, layers })
  }

  return (
    <div className="w-56 shrink-0 border-r border-slate-800 flex flex-col bg-slate-950">
      {/* Add buttons */}
      <div className="p-3 border-b border-slate-800 space-y-1.5">
        <button
          onClick={addText}
          className="w-full px-2.5 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded transition"
        >
          + Text
        </button>
        <button
          onClick={() => addImage('image/png,image/jpeg,image/webp', 'png')}
          className="w-full px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition"
        >
          + Image (PNG/JPG)
        </button>
        <button
          onClick={() => addImage('image/svg+xml', 'svg')}
          className="w-full px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition"
        >
          + SVG
        </button>
      </div>

      {/* Layer list (top of list = top of canvas — render in reverse so top item is drawn last) */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {composition.layers.length === 0 && (
          <p className="text-center text-xs text-slate-600 py-6">No layers</p>
        )}
        {[...composition.layers].reverse().map((layer) => (
          <div
            key={layer.id}
            onClick={() => onSelect(layer.id)}
            className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs ${
              selectedId === layer.id
                ? 'bg-indigo-900/40 border border-indigo-700/50'
                : 'bg-slate-800 hover:bg-slate-700 border border-transparent'
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleVisible(layer.id)
              }}
              className="text-slate-500 hover:text-slate-300"
              title={layer.visible === false ? 'Show' : 'Hide'}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {layer.visible === false ? (
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" />
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
            <span className="flex-1 truncate text-slate-200">
              {layer.kind === 'text' ? layer.text || 'Text' : `Image (${layer.format.toUpperCase()})`}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                moveLayer(layer.id, 1)
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300"
              title="Move up"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                moveLayer(layer.id, -1)
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300"
              title="Move down"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeLayer(layer.id)
              }}
              className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
              title="Delete"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
