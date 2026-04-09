import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '@/shared/store/ui.store'
import { useCreateBlock } from '@/features/blocks/hooks'
import { get } from '@/shared/api/client'
import { to12h } from '@/features/blocks/utils'
import type { Block } from '@/shared/types'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'

interface ScheduleTemplate {
  id: string | number
  name: string
  category: string
  start_time: string
  end_time: string
  days: string[]
  content_type: Block['content_type']
  notes?: string
}

export function TemplatesLibraryModal() {
  const { modals, closeModal, selectedChannel } = useUIStore()
  const isOpen = modals.templatesLibrary

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const createBlock = useCreateBlock()

  const { data: templates = [], isLoading, isError } = useQuery<ScheduleTemplate[]>({
    queryKey: ['schedule-templates'],
    queryFn: async () => {
      const res = await get<{ version?: number; categories?: Array<{ id: string; label: string; templates: Array<Omit<ScheduleTemplate, 'category'>> }> }>('/api/schedule-templates')
      // Backend returns { version, categories: [{ id, label, templates }] } — flatten to ScheduleTemplate[]
      if (res && Array.isArray(res.categories)) {
        return res.categories.flatMap((cat) =>
          (cat.templates || []).map((t) => ({ ...t, category: cat.label }))
        )
      }
      // Fallback: if somehow it's already a flat array
      if (Array.isArray(res)) return res as unknown as ScheduleTemplate[]
      return []
    },
    enabled: isOpen,
  })

  const categories = [...new Set(templates.map((t) => t.category))].sort()

  const activeCategory = selectedCategory ?? categories[0] ?? null

  const filtered = activeCategory
    ? templates.filter((t) => t.category === activeCategory)
    : templates

  function handleClose() {
    closeModal('templatesLibrary')
  }

  function handleApply(template: ScheduleTemplate) {
    createBlock.mutate(
      {
        name: template.name,
        start_time: template.start_time,
        end_time: template.end_time,
        days: template.days,
        content_type: template.content_type,
        notes: template.notes ?? '',
        channel_number: selectedChannel?.number ?? null,
      },
      { onSuccess: () => handleClose() },
    )
  }

  return (
    <ModalWrapper open={isOpen} onClose={handleClose} maxWidth="max-w-3xl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Schedule Templates</h2>
        <button
          onClick={handleClose}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex h-[60vh]">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}

        {isError && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-red-400">Failed to load templates.</p>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            {/* Category sidebar */}
            <aside className="w-44 flex-shrink-0 border-r border-slate-700 overflow-y-auto py-2">
              {categories.length === 0 && (
                <p className="text-xs text-slate-500 px-4 py-3">No categories</p>
              )}
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    activeCategory === cat
                      ? 'bg-slate-700 text-slate-100 border-l-2 border-indigo-500'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border-l-2 border-transparent'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </aside>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-slate-500">No templates in this category.</p>
                </div>
              )}

              <div className="divide-y divide-slate-700/50">
                {filtered.map((template) => (
                  <div
                    key={template.id}
                    className="px-5 py-4 flex items-start gap-4 hover:bg-slate-700/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100">{template.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400">
                          {to12h(template.start_time)} – {to12h(template.end_time)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {template.days.join(', ')}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          template.content_type === 'shows'
                            ? 'bg-blue-900/50 text-blue-300'
                            : template.content_type === 'movies'
                              ? 'bg-purple-900/50 text-purple-300'
                              : 'bg-slate-700 text-slate-300'
                        }`}>
                          {template.content_type.charAt(0).toUpperCase() + template.content_type.slice(1)}
                        </span>
                      </div>
                      {template.notes && (
                        <p className="text-xs text-slate-500 mt-1 italic">{template.notes}</p>
                      )}
                    </div>

                    <button
                      onClick={() => handleApply(template)}
                      disabled={createBlock.isPending}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-indigo-100 rounded transition-colors disabled:opacity-50"
                    >
                      {createBlock.isPending ? <Spinner size="sm" /> : null}
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  )
}
