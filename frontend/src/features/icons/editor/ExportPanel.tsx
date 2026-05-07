import { useState } from 'react'
import type { Composition, Background, ColorMode } from './types'
import {
  applyColorMode,
  renderSVG,
  rasterizeToPng,
  downloadBlob,
  exportAllVariants,
} from './render'

interface Props {
  composition: Composition
  onChange: (comp: Composition) => void
  baseName?: string
}

const labelClass = 'text-[10px] uppercase text-slate-500 font-medium tracking-wide'

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'all-black', label: 'All Black' },
  { id: 'all-white', label: 'All White' },
  { id: 'text-white-image-original', label: 'Text White / Image Original' },
]

export function ExportPanel({ composition, onChange, baseName = 'icon' }: Props) {
  const [exportMode, setExportMode] = useState<ColorMode>('original')

  const updateBg = (patch: Partial<Background>) => {
    onChange({ ...composition, background: { ...composition.background, ...patch } })
  }

  const exportSvg = async () => {
    const recolored = applyColorMode(composition, exportMode)
    const svg = renderSVG(recolored)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlob(blob, `${baseName}-${exportMode}.svg`)
  }

  const exportPng = async () => {
    const recolored = applyColorMode(composition, exportMode)
    const svg = renderSVG(recolored)
    const blob = await rasterizeToPng(svg, composition.size)
    downloadBlob(blob, `${baseName}-${exportMode}.png`)
  }

  const exportAll = async () => {
    await exportAllVariants(composition, baseName)
  }

  // Parse gradient value
  const grad =
    composition.background.type === 'gradient' ? composition.background.value.split('|') : []
  const gradAngle = grad[0] ? parseFloat(grad[0]) : 135
  const gradC1 = grad[1] || '#6366f1'
  const gradC2 = grad[2] || '#a855f7'

  return (
    <div className="p-3 space-y-4 border-t border-slate-800">
      {/* Background */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Background</h3>
        <div className="flex gap-1">
          {(['transparent', 'solid', 'gradient'] as const).map((t) => (
            <button
              key={t}
              onClick={() =>
                updateBg({
                  type: t,
                  value:
                    t === 'transparent' ? '' : t === 'solid' ? '#1e293b' : '135|#6366f1|#a855f7',
                })
              }
              className={`flex-1 px-2 py-1 text-xs rounded ${
                composition.background.type === t
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {composition.background.type === 'solid' && (
          <input
            type="color"
            value={composition.background.value || '#1e293b'}
            onChange={(e) => updateBg({ value: e.target.value })}
            className="w-full h-8 bg-transparent border border-slate-700 rounded cursor-pointer"
          />
        )}
        {composition.background.type === 'gradient' && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className={labelClass}>Angle</label>
              <input
                type="range"
                min={0}
                max={360}
                value={gradAngle}
                onChange={(e) => updateBg({ value: `${e.target.value}|${gradC1}|${gradC2}` })}
                className="flex-1"
              />
              <span className="text-xs text-slate-500 w-10">{gradAngle}°</span>
            </div>
            <div className="flex gap-2">
              <input
                type="color"
                value={gradC1}
                onChange={(e) => updateBg({ value: `${gradAngle}|${e.target.value}|${gradC2}` })}
                className="flex-1 h-8 bg-transparent border border-slate-700 rounded cursor-pointer"
              />
              <input
                type="color"
                value={gradC2}
                onChange={(e) => updateBg({ value: `${gradAngle}|${gradC1}|${e.target.value}` })}
                className="flex-1 h-8 bg-transparent border border-slate-700 rounded cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* Export */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Export</h3>
        <div>
          <label className={labelClass}>Color Mode</label>
          <select
            value={exportMode}
            onChange={(e) => setExportMode(e.target.value as ColorMode)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
          >
            {COLOR_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportSvg}
            className="flex-1 px-2 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
          >
            Download SVG
          </button>
          <button
            onClick={exportPng}
            className="flex-1 px-2 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
          >
            Download PNG
          </button>
        </div>
        <button
          onClick={exportAll}
          className="w-full px-2 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded"
        >
          Download All Variants (8 files)
        </button>
      </div>
    </div>
  )
}
