import { useState, useEffect, type FormEvent } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { useUIStore } from '@/shared/store/ui.store'
import { useCreateChannel, useUpdateChannel } from '@/features/channels/hooks'
import type { Channel } from '@/shared/types'

const TIERS: Channel['tier'][] = ['Galaxy Main', 'Classics', 'Galaxy Premium']
const MODES = ['Shuffle', 'Flex', 'Sequential']
const TIER_COLORS: Record<string, string> = {
  'Galaxy Main': 'blue',
  Classics: 'amber',
  'Galaxy Premium': 'purple',
}

export function ChannelFormModal() {
  const { modals, editingChannel, closeModal } = useUIStore()
  const open = modals.channelForm
  const isEditing = editingChannel !== null

  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()

  const [number, setNumber] = useState<string>('')
  const [name, setName] = useState('')
  const [tier, setTier] = useState<Channel['tier']>('Galaxy Main')
  const [vibe, setVibe] = useState('')
  const [mode, setMode] = useState('Shuffle')
  const [style, setStyle] = useState('')
  const [color, setColor] = useState('')
  const [autoAssign, setAutoAssign] = useState(false)
  const [createTunarr, setCreateTunarr] = useState(false)

  // Sync form state when editingChannel changes or modal opens
  useEffect(() => {
    if (open) {
      setNumber(editingChannel?.number?.toString() ?? '')
      setName(editingChannel?.name ?? '')
      setTier(editingChannel?.tier ?? 'Galaxy Main')
      setVibe(editingChannel?.vibe ?? '')
      setMode(editingChannel?.mode ?? 'Shuffle')
      setStyle(editingChannel?.style ?? '')
      setColor(editingChannel?.color ?? '')
      setAutoAssign(false)
      setCreateTunarr(false)
    }
  }, [open, editingChannel])

  // Auto-pick color from tier when creating (not editing)
  useEffect(() => {
    if (!isEditing && tier) {
      setColor(TIER_COLORS[tier] ?? 'blue')
    }
  }, [tier, isEditing])

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

        <div className="px-6 py-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Channel Number */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel Number</label>
              <input
                type="number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
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
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Style */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Style</label>
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
