import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels, useCreateChannel, useUpdateChannel } from '@/features/channels/hooks'
import { useAiSuggestChannels } from '@/features/ai/hooks'
import type { AiChannelSuggestion, Channel } from '@/shared/types'
import {
  NETWORK_PRESETS,
  NETWORK_CATEGORIES,
  type NetworkPreset,
} from '@/features/channels/presets/networks'
import { VIBE_TEMPLATES, STYLE_TEMPLATES } from '@/features/channels/presets/templates'
import { nextAvailableNumber } from '@/features/channels/presets/numbering'

const TIERS: Channel['tier'][] = ['Galaxy Main', 'Classics', 'Galaxy Premium']
const MODES = ['Shuffle', 'Flex', 'Sequential']
const TIER_COLORS: Record<string, string> = {
  'Galaxy Main': 'blue',
  Classics: 'amber',
  'Galaxy Premium': 'purple',
}

export function ChannelFormModal() {
  const { modals, editingChannel, closeModal, openModal } = useUIStore()
  const open = modals.channelForm
  const isEditing = editingChannel !== null

  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const aiSuggest = useAiSuggestChannels()
  const { data: existingChannels = [] } = useChannels()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [number, setNumber] = useState<string>('')
  const [numberTouched, setNumberTouched] = useState(false)
  const [name, setName] = useState('')
  const [tier, setTier] = useState<Channel['tier']>('Galaxy Main')
  const [vibe, setVibe] = useState('')
  const [mode, setMode] = useState('Shuffle')
  const [style, setStyle] = useState('')
  const [color, setColor] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [autoAssign, setAutoAssign] = useState(false)
  const [createTunarr, setCreateTunarr] = useState(false)

  // Smart channel creation: preset picker + AI suggestions
  const [presetCategory, setPresetCategory] = useState<string>('all')
  const [presetSearch, setPresetSearch] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)

  const existingNumbers = useMemo(() => existingChannels.map((c) => c.number), [existingChannels])

  const filteredPresets = useMemo(() => {
    return NETWORK_PRESETS.filter((p) => {
      if (presetCategory !== 'all' && p.category !== presetCategory) return false
      if (presetSearch && !p.name.toLowerCase().includes(presetSearch.toLowerCase())) return false
      return true
    })
  }, [presetCategory, presetSearch])

  const aiChannels: AiChannelSuggestion[] = aiSuggest.data?.suggestions?.channels ?? []

  // Sync form state when editingChannel changes or modal opens
  useEffect(() => {
    if (open) {
      const initialTier = editingChannel?.tier ?? 'Galaxy Main'
      setNumber(editingChannel?.number?.toString() ?? '')
      setNumberTouched(false)
      setName(editingChannel?.name ?? '')
      setTier(initialTier)
      setVibe(editingChannel?.vibe ?? '')
      setMode(editingChannel?.mode ?? 'Shuffle')
      setStyle(editingChannel?.style ?? '')
      setColor(editingChannel?.color ?? '')
      setIcon(editingChannel?.icon ?? null)
      setAutoAssign(false)
      setCreateTunarr(false)
      setPresetCategory('all')
      setPresetSearch('')
      setShowAiPanel(false)
    }
  }, [open, editingChannel])

  // Auto-pick color from tier when creating (not editing)
  useEffect(() => {
    if (!isEditing && tier) {
      setColor(TIER_COLORS[tier] ?? 'blue')
    }
  }, [tier, isEditing])

  // Auto-suggest channel number based on tier (create mode, only if user hasn't typed)
  useEffect(() => {
    if (open && !isEditing && !numberTouched && existingChannels.length >= 0) {
      const next = nextAvailableNumber(existingNumbers, tier)
      setNumber(String(next))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditing, tier, existingChannels.length])

  // Apply a preset to the form
  function applyPreset(p: NetworkPreset) {
    setName(p.name)
    setTier(p.tier)
    setVibe(p.vibe)
    setMode(p.mode)
    setStyle(p.style)
    setColor(p.color)
    if (!numberTouched) {
      setNumber(String(nextAvailableNumber(existingNumbers, p.tier)))
    }
  }

  // Apply an AI suggestion to the form
  function applyAiSuggestion(s: AiChannelSuggestion) {
    setName(s.name)
    if (s.tier === 'Galaxy Main' || s.tier === 'Classics' || s.tier === 'Galaxy Premium') {
      setTier(s.tier)
    }
    setVibe(s.vibe)
    setStyle(s.description)
    if (!numberTouched && s.number) {
      setNumber(String(s.number))
    }
    setShowAiPanel(false)
  }

  function handleClose() {
    closeModal('channelForm')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const data: Partial<Channel> = {
      number: parseInt(number, 10),
      name,
      tier,
      vibe,
      mode,
      style,
      color,
      icon,
    }

    if (isEditing) {
      updateChannel.mutate({ number: editingChannel!.number, data }, { onSuccess: handleClose })
    } else {
      createChannel.mutate(data, { onSuccess: handleClose })
    }
  }

  const isPending = createChannel.isPending || updateChannel.isPending

  return (
    <ModalWrapper open={open} onClose={handleClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">
            {isEditing ? `Edit Channel ${editingChannel!.number}` : 'New Channel'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {/* Smart suggestions — create mode only */}
          {!isEditing && (
            <>
              {/* Preset picker */}
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400 font-semibold">
                    Start from a preset
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAiPanel((v) => !v)}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1-3-7z" />
                    </svg>
                    Suggest with AI
                  </button>
                </div>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="Search networks…"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <select
                    value={presetCategory}
                    onChange={(e) => setPresetCategory(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="all">All categories</option>
                    {NETWORK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {filteredPresets.length === 0 ? (
                    <p className="text-xs text-slate-500 py-1">No matching presets</p>
                  ) : (
                    filteredPresets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPreset(p)}
                        className="px-2 py-1 text-xs bg-slate-800 hover:bg-indigo-700 hover:text-white border border-slate-700 hover:border-indigo-500 text-slate-300 rounded transition-colors"
                        title={`${p.tier} · ${p.vibe}`}
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* AI suggestions panel */}
              {showAiPanel && (
                <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-indigo-300 font-semibold">
                      AI Channel Suggestions
                    </span>
                    {!aiSuggest.data && !aiSuggest.isPending && (
                      <button
                        type="button"
                        onClick={() => aiSuggest.mutate()}
                        className="px-2 py-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded"
                      >
                        Generate
                      </button>
                    )}
                  </div>
                  {aiSuggest.isPending && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                      <Spinner size="sm" />
                      Analyzing your library…
                    </div>
                  )}
                  {aiSuggest.isError && (
                    <p className="text-xs text-red-400">
                      AI suggestion failed. Check your AI settings.
                    </p>
                  )}
                  {aiChannels.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {aiChannels.map((s, i) => (
                        <button
                          key={`${s.number}-${i}`}
                          type="button"
                          onClick={() => applyAiSuggestion(s)}
                          className="w-full text-left px-2 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500 rounded transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-500">CH {s.number}</span>
                            <span className="font-medium text-slate-200">{s.name}</span>
                            <span className="text-[10px] text-slate-500 ml-auto">{s.tier}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {s.vibe} — {s.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Icon */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Channel Icon</label>
            <div className="flex items-center gap-3">
              {icon ? (
                <img
                  src={icon}
                  alt="Icon"
                  className="w-16 h-16 rounded-lg border border-slate-700 object-contain bg-slate-900"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-600 text-[10px]">
                  No icon
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 flex-1">
                <button
                  type="button"
                  onClick={() =>
                    openModal('iconPicker', {
                      iconPickerCallback: (dataUrl: string) => setIcon(dataUrl),
                    })
                  }
                  className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                >
                  Pick from Library
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openModal('iconEditor', {
                      iconEditorCallback: (dataUrl: string) => setIcon(dataUrl),
                    })
                  }
                  className="px-2.5 py-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded"
                >
                  Create New
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                >
                  Upload
                </button>
                {icon && (
                  <button
                    type="button"
                    onClick={() => setIcon(null)}
                    className="px-2.5 py-1 text-xs bg-red-900/40 hover:bg-red-900/60 border border-red-800/50 text-red-400 rounded"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => setIcon(reader.result as string)
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Channel Number */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel Number</label>
              <input
                type="number"
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value)
                  setNumberTouched(true)
                }}
                required
                min={1}
                max={9999}
                disabled={isEditing}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Color</label>
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#hex"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Tier */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as Channel['tier'])}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Mode */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Vibe */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Vibe</label>
            <input
              type="text"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="e.g. Cozy crime procedurals"
              list="vibe-templates"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <datalist id="vibe-templates">
              {VIBE_TEMPLATES.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          {/* Style */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Style</label>
              <details className="relative">
                <summary className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer list-none">
                  Quick templates ▾
                </summary>
                <div className="absolute right-0 top-5 z-10 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 max-h-64 overflow-y-auto">
                  <div className="flex flex-col gap-1">
                    {STYLE_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={(e) => {
                          setStyle(t.text)
                          // close the <details> wrapper
                          const det =
                            (e.currentTarget.closest('details') as HTMLDetailsElement) ?? null
                          if (det) det.open = false
                        }}
                        className="text-left px-2 py-1 text-xs hover:bg-slate-800 rounded"
                        title={t.text}
                      >
                        <span className="text-slate-200 font-medium">{t.label}</span>
                        <p className="text-[11px] text-slate-500 truncate">{t.text}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </div>
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              rows={3}
              placeholder="Brief channel identity description"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Create-only checkboxes */}
          {!isEditing && (
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAssign}
                  onChange={(e) => setAutoAssign(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-indigo-500"
                />
                <span className="text-sm text-slate-300">Auto-assign 24/7 content</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createTunarr}
                  onChange={(e) => setCreateTunarr(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-indigo-500"
                />
                <span className="text-sm text-slate-300">Create Tunarr channel</span>
              </label>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {isPending && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {isEditing ? 'Save Changes' : 'Create Channel'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}
