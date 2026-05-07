/**
 * Reusable multi-layer icon editor.
 *
 * Usage:
 *   <IconEditor
 *     composition={comp}
 *     onChange={setComp}
 *     selectedId={id}
 *     onSelect={setId}
 *     iconName={name}
 *     onNameChange={setName}
 *   />
 *
 * This is the pure editor UI (3-panel layout). The parent owns the state
 * and provides save/close logic — making it reusable in modals, pages, etc.
 */
import { LayerPanel } from './LayerPanel'
import { EditorCanvas } from './EditorCanvas'
import { PropertiesPanel } from './PropertiesPanel'
import { ExportPanel } from './ExportPanel'
import type { Composition } from './types'

interface IconEditorProps {
  composition: Composition
  onChange: (comp: Composition) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  iconName: string
  onNameChange?: (name: string) => void
  /** Optional class name on the outer wrapper */
  className?: string
}

export function IconEditor({
  composition,
  onChange,
  selectedId,
  onSelect,
  iconName,
  onNameChange,
  className = '',
}: IconEditorProps) {
  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${className}`}>
      {/* Name input bar */}
      {onNameChange && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-950 shrink-0">
          <label className="text-xs text-slate-500">Name</label>
          <input
            type="text"
            value={iconName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Icon name…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
          />
        </div>
      )}

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        <LayerPanel
          composition={composition}
          selectedId={selectedId}
          onSelect={onSelect}
          onChange={onChange}
        />
        <EditorCanvas
          composition={composition}
          selectedId={selectedId}
          onSelect={onSelect}
          onChange={onChange}
        />
        <div className="w-72 shrink-0 border-l border-slate-800 flex flex-col bg-slate-950 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <PropertiesPanel
              composition={composition}
              selectedId={selectedId}
              onChange={onChange}
            />
          </div>
          <ExportPanel
            composition={composition}
            onChange={onChange}
            baseName={iconName.toLowerCase().replace(/\s+/g, '-') || 'icon'}
          />
        </div>
      </div>
    </div>
  )
}
