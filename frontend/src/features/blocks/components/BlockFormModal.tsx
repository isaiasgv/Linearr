import { useState, useEffect } from 'react'
import { useUIStore } from '@/shared/store/ui.store'
import { useCreateBlock, useUpdateBlock } from '@/features/blocks/hooks'
import { BLOCK_PRESETS, ALL_DAYS } from '@/features/blocks/types'
import type { Block } from '@/shared/types'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'

type ContentType = Block['content_type']

interface FormState {
  name: string
  days: string[]
  start_time: string
  end_time: string
  content_type: ContentType
  notes: string
}

const DEFAULT_FORM: FormState = {
  name: '',
  days: [...ALL_DAYS],
  start_time: '20:00',
  end_time: '23:00',
  content_type: 'both',
  notes: '',
}

export function BlockFormModal() {
  const { modals, closeModal, editingBlock, selectedChannel, activeView } = useUIStore()
  const isOpen = modals.blockForm

  const createBlock = useCreateBlock()
  const updateBlock = useUpdateBlock()

  const [form, setForm] = useState<FormState>(DEFAULT_FORM)

  // Populate form from editingBlock when modal opens
  useEffect(() => {
    if (isOpen) {
      if (editingBlock) {
        setForm({
          name: editingBlock.name,
          days: editingBlock.days,
          start_time: editingBlock.start_time,
          end_time: editingBlock.end_time,
          content_type: editingBlock.content_type,
          notes: editingBlock.notes ?? '',
        })
      } else {
        setForm(DEFAULT_FORM)
      }
    }
  }, [isOpen, editingBlock])

  function applyPreset(preset: (typeof BLOCK_PRESETS)[number]) {
    setForm((f) => ({
      ...f,
      name: preset.name,
      start_time: preset.start_time,
      end_time: preset.end_time,
      days: preset.days,
      content_type: preset.content_type,
    }))
  }

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day],
    }))
  }

  function handleClose() {
    closeModal('blockForm')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const payload: Partial<Block> = {
      ...form,
      channel_number: activeView === 'generic' ? null : (editingBlock?.channel_number ?? selectedChannel?.number ?? null),
    }

    if (editingBlock) {
      updateBlock.mutate({ id: editingBlock.id, data: payload }, { onSuccess: () => handleClose() })
    } else {
      createBlock.mutate(payload, { onSuccess: () => handleClose() })
    }
  }

  const isPending = createBlock.isPending || updateBlock.isPending

  return (
    <ModalWrapper open={isOpen} onClose={handleClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit}>
        {/* Modal header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">
            {editingBlock ? 'Edit Block' : 'New Block'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded transition-colors"
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
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Preset chips */}
          <div>
            <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">
              Presets
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-slate-100 rounded-full border border-slate-600 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Block Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Primetime"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                required
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">End Time</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                required
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Days */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    form.days.includes(day)
                      ? 'bg-indigo-700 text-indigo-100 border border-indigo-600'
                      : 'bg-slate-700 text-slate-400 border border-slate-600 hover:border-slate-500'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Content type */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Content Type</label>
            <div className="flex gap-2">
              {(['shows', 'movies', 'both'] as ContentType[]).map((type) => (
                <label
                  key={type}
                  className={`flex items-center gap-2 flex-1 cursor-pointer px-3 py-2 rounded-lg border text-sm transition-colors ${
                    form.content_type === type
                      ? 'border-indigo-600 bg-indigo-900/30 text-indigo-300'
                      : 'border-slate-600 bg-slate-900 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="content_type"
                    value={type}
                    checked={form.content_type === type}
                    onChange={() => setForm((f) => ({ ...f, content_type: type }))}
                    className="sr-only"
                  />
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes..."
              rows={3}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-700 hover:bg-indigo-600 text-indigo-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending && <Spinner size="sm" />}
            {editingBlock ? 'Save Changes' : 'Create Block'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}
