import { useState } from 'react'
import { Spinner } from '@/shared/components/ui/Spinner'
import {
  useSavedIcons,
  useSaveIcon,
  useDeleteSavedIcon,
  useAssignIconToChannel,
  useSeedIconPack,
  useImportFromTunarr,
} from '../hooks'
import { useChannels } from '@/features/channels/hooks'
import { useUIStore } from '@/shared/store/ui.store'
import { useToastStore } from '@/shared/store/toast.store'
import type { SavedIcon } from '../api'
import { IconEditor } from '../editor/IconEditor'
import { defaultComposition, newTextLayer, type Composition } from '../editor/types'
import { compositionToPngDataUrl } from '../editor/render'

const PRESET_GRADIENTS: [string, string, string][] = [
  ['Indigo', '#4f46e5', '#818cf8'],
  ['Purple', '#7c3aed', '#a855f7'],
  ['Blue', '#2563eb', '#60a5fa'],
  ['Cyan', '#0891b2', '#22d3ee'],
  ['Emerald', '#059669', '#34d399'],
  ['Amber', '#d97706', '#fbbf24'],
  ['Red', '#dc2626', '#f87171'],
  ['Pink', '#db2777', '#f472b6'],
  ['Slate', '#334155', '#64748b'],
  ['Zinc', '#27272a', '#52525b'],
]

const CLASSIC_PRESETS = [
  { name: 'Cartoon Network', colors: ['#000000', '#00aeef'] },
  { name: 'Boomerang', colors: ['#1a1a2e', '#e94560'] },
  { name: 'Disney Channel', colors: ['#113ccf', '#2196f3'] },
  { name: 'Disney XD', colors: ['#8bc34a', '#4caf50'] },
  { name: 'Nickelodeon', colors: ['#ff6f00', '#ff9800'] },
  { name: 'Nicktoons', colors: ['#ff5722', '#ff9800'] },
  { name: 'MTV', colors: ['#1a1a1a', '#ffc107'] },
  { name: 'Comedy Central', colors: ['#1a1a1a', '#ff5722'] },
  { name: 'Syfy', colors: ['#1b0533', '#7b1fa2'] },
  { name: 'TNT', colors: ['#c62828', '#e53935'] },
  { name: 'TBS', colors: ['#1565c0', '#42a5f5'] },
  { name: 'FX', colors: ['#1a1a1a', '#b0bec5'] },
  { name: 'AMC', colors: ['#1a1a1a', '#4caf50'] },
  { name: 'HBO', colors: ['#000000', '#7b1fa2'] },
  { name: 'Showtime', colors: ['#b71c1c', '#e53935'] },
  { name: 'ABC', colors: ['#000000', '#2196f3'] },
  { name: 'NBC', colors: ['#ff9800', '#4caf50'] },
  { name: 'CBS', colors: ['#1565c0', '#0d47a1'] },
  { name: 'FOX', colors: ['#1565c0', '#64b5f6'] },
  { name: 'USA Network', colors: ['#1565c0', '#42a5f5'] },
]

// Old canvas-based editor removed — now using the shared IconEditor component

export function IconLibraryView() {
  const { data: icons = [], isLoading } = useSavedIcons()
  const { data: channels = [] } = useChannels()
  const saveIcon = useSaveIcon()
  const deleteIcon = useDeleteSavedIcon()
  const assignIcon = useAssignIconToChannel()
  const seedPack = useSeedIconPack()
  const importTunarr = useImportFromTunarr()

  const addToast = useToastStore((s) => s.addToast)
  const openModal = useUIStore((s) => s.openModal)

  const [tab, setTab] = useState<'library' | 'editor' | 'presets'>('library')
  const [iconName, setIconName] = useState('New Icon')
  const [assignChannel, setAssignChannel] = useState('')
  const [selectedIcon, setSelectedIcon] = useState<SavedIcon | null>(null)
  const [previewIcon, setPreviewIcon] = useState<SavedIcon | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Composition state for the shared IconEditor
  const [composition, setComposition] = useState<Composition>(defaultComposition())
  const [editorSelectedId, setEditorSelectedId] = useState<string | null>(null)

  const categories = ['all', ...new Set(icons.map((i) => i.category))]
  const filteredIcons =
    categoryFilter === 'all' ? icons : icons.filter((i) => i.category === categoryFilter)

  // ── Editor save handler (uses shared composition) ──
  async function handleEditorSave() {
    try {
      const dataUrl = await compositionToPngDataUrl(composition)
      saveIcon.mutate({ name: iconName, category: 'custom', data: dataUrl, composition })
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', true)
    }
  }

  function handleAssignToChannel() {
    if (!assignChannel || !selectedIcon) return
    assignIcon.mutate({ channelNumber: Number(assignChannel), iconData: selectedIcon.data })
  }

  function loadPreset(name: string, c1: string, c2: string) {
    const layer = newTextLayer(name)
    setComposition({
      layers: [layer],
      background: { type: 'gradient', value: `135|${c1}|${c2}` },
      size: 512,
    })
    setEditorSelectedId(layer.id)
    setIconName(name)
    setTab('editor')
  }

  const [loadingPack, setLoadingPack] = useState(false)

  async function handleImportClassicsPack() {
    setLoadingPack(true)
    try {
      const res = await fetch('/classics-icon-pack.json')
      if (!res.ok) throw new Error(`Failed to load pack: ${res.status}`)
      const pack = await res.json()
      seedPack.mutate(pack)
    } catch (err) {
      console.error('Import classics pack error:', err)
    } finally {
      setLoadingPack(false)
    }
  }

  function loadIconForEdit(icon: SavedIcon) {
    setSelectedIcon(icon)
    setIconName(icon.name)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Icon Library</h2>
        <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5">
          {(['library', 'editor', 'presets'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {t === 'library'
                ? `Library (${icons.length})`
                : t === 'editor'
                  ? 'Create'
                  : 'Presets'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ── Library tab ── */}
        {tab === 'library' && (
          <div className="p-4 space-y-4">
            {/* Category filter */}
            <div className="flex gap-1 flex-wrap">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition ${
                    categoryFilter === c
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : filteredIcons.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                <p>No icons yet. Create one in the editor or use a preset.</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                {filteredIcons.map((icon) => (
                  <div
                    key={icon.id}
                    className={`group relative cursor-pointer rounded-xl border-2 p-1 transition ${
                      selectedIcon?.id === icon.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-transparent hover:border-slate-600'
                    }`}
                    onClick={() => loadIconForEdit(icon)}
                    onDoubleClick={() => setPreviewIcon(icon)}
                  >
                    <img
                      src={icon.data}
                      alt={icon.name}
                      loading="lazy"
                      className="w-full aspect-square rounded-lg object-contain bg-slate-900"
                    />
                    <p className="text-xs text-slate-400 text-center truncate mt-1">{icon.name}</p>
                    {icon.category === 'projects' && (
                      <span className="absolute bottom-7 left-1 text-[9px] bg-indigo-600/80 text-white rounded px-1 py-0">
                        Project
                      </span>
                    )}
                    {/* Preview button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewIcon(icon)
                      }}
                      className="absolute top-1 left-1 w-5 h-5 bg-slate-800/80 rounded text-slate-300 text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                      title="View full size"
                    >
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                    </button>
                    {/* Edit button (only for project icons with composition) */}
                    {icon.composition && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          let comp: unknown = icon.composition
                          if (typeof comp === 'string') {
                            try {
                              comp = JSON.parse(comp)
                            } catch {
                              return
                            }
                          }
                          openModal('iconEditor', {
                            iconEditorComposition: comp,
                            iconEditorId: icon.id,
                            iconEditorName: icon.name,
                          })
                        }}
                        className="absolute top-1 right-1 w-5 h-5 bg-indigo-600/90 rounded text-white text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                        title="Edit in editor"
                      >
                        <svg
                          className="w-3 h-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteIcon.mutate(icon.id)
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Assign to channel */}
            {selectedIcon && (
              <div className="mt-4 p-4 bg-slate-900 border border-slate-700 rounded-xl flex items-center gap-3">
                <img src={selectedIcon.data} alt="" className="w-12 h-12 rounded-lg" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200">{selectedIcon.name}</p>
                  <p className="text-xs text-slate-500">Select a channel to assign this icon</p>
                </div>
                <select
                  value={assignChannel}
                  onChange={(e) => setAssignChannel(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                >
                  <option value="">Select channel...</option>
                  {channels.map((ch) => (
                    <option key={ch.number} value={ch.number}>
                      {ch.number} — {ch.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAssignToChannel}
                  disabled={!assignChannel || assignIcon.isPending}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition"
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Editor tab — uses shared IconEditor component ── */}
        {tab === 'editor' && (
          <div className="flex flex-col h-full">
            {/* Save bar */}
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-800 shrink-0">
              <button
                onClick={handleEditorSave}
                disabled={saveIcon.isPending || composition.layers.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded"
              >
                {saveIcon.isPending && <Spinner size="sm" />}
                Save to Library
              </button>
            </div>
            <IconEditor
              composition={composition}
              onChange={setComposition}
              selectedId={editorSelectedId}
              onSelect={setEditorSelectedId}
              iconName={iconName}
              onNameChange={setIconName}
            />
          </div>
        )}

        {/* ── Presets tab ── */}
        {tab === 'presets' && (
          <div className="p-4 space-y-6">
            {/* Import classics pack */}
            <div className="bg-indigo-900/20 border border-indigo-700/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-indigo-200">Classics Icon Pack</h3>
                <p className="text-xs text-indigo-400/70 mt-0.5">
                  22 real network logos — Cartoon Network, Nickelodeon, Disney, MTV, and more.
                  Auto-assigns to matching channels.
                </p>
              </div>
              <button
                onClick={handleImportClassicsPack}
                disabled={loadingPack || seedPack.isPending}
                className="shrink-0 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition"
              >
                {loadingPack || seedPack.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                )}
                {loadingPack
                  ? 'Downloading...'
                  : seedPack.isPending
                    ? 'Installing...'
                    : 'Install Pack'}
              </button>
            </div>

            {/* Import from Tunarr */}
            <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-emerald-200">Import from Tunarr</h3>
                <p className="text-xs text-emerald-400/70 mt-0.5">
                  Fetch channel icons from your linked Tunarr channels and add them to the library.
                  Auto-assigns to matching Linearr channels.
                </p>
              </div>
              <button
                onClick={() => importTunarr.mutate()}
                disabled={importTunarr.isPending}
                className="shrink-0 flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition"
              >
                {importTunarr.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
                Import Icons
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Classic Networks</h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {CLASSIC_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => loadPreset(p.name, p.colors[0], p.colors[1])}
                    className="group text-center p-2 rounded-xl border border-slate-700 hover:border-indigo-500 transition bg-slate-900 hover:bg-slate-800"
                  >
                    <div
                      className="w-full aspect-square rounded-lg flex items-center justify-center text-white text-xs font-bold"
                      style={{
                        background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`,
                      }}
                    >
                      {p.name
                        .split(' ')
                        .map((w) => w[0])
                        .join('')
                        .slice(0, 3)}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5 truncate">{p.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Gradient Templates</h3>
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                {PRESET_GRADIENTS.map(([name, c1, c2]) => (
                  <button
                    key={name}
                    onClick={() => loadPreset(name, c1, c2)}
                    title={name}
                    className="aspect-square rounded-lg border border-slate-700 hover:border-indigo-500 transition"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Full-size preview overlay */}
      {previewIcon && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewIcon(null)}
        >
          <div className="relative max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewIcon.data}
              alt={previewIcon.name}
              className="w-full rounded-2xl border border-slate-700 shadow-2xl bg-slate-900 object-contain"
            />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-2xl p-4">
              <p className="text-sm font-semibold text-white">{previewIcon.name}</p>
              <p className="text-xs text-slate-400">{previewIcon.category}</p>
            </div>
            <button
              onClick={() => setPreviewIcon(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-slate-800 border border-slate-600 rounded-full text-slate-300 hover:text-white flex items-center justify-center transition"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="flex gap-2 mt-3 justify-center">
              <button
                onClick={() => {
                  loadIconForEdit(previewIcon)
                  setPreviewIcon(null)
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition"
              >
                Select
              </button>
              <a
                href={previewIcon.data}
                download={`${previewIcon.name}.png`}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition"
              >
                Download
              </a>
              <button
                onClick={() => {
                  deleteIcon.mutate(previewIcon.id)
                  setPreviewIcon(null)
                }}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-900/70 border border-red-800/50 text-red-400 text-xs rounded-lg transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
