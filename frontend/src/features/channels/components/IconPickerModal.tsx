import { useMemo, useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useSavedIcons } from '@/features/icons/hooks'

export function IconPickerModal() {
  const open = useUIStore((s) => s.modals.iconPicker)
  const closeModal = useUIStore((s) => s.closeModal)
  const callback = useUIStore((s) => s.iconPickerCallback)
  const { data: icons = [], isLoading } = useSavedIcons()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')

  const categories = useMemo(() => {
    const set = new Set<string>(['all'])
    icons.forEach((i) => set.add(i.category))
    return Array.from(set)
  }, [icons])

  const filtered = useMemo(() => {
    return icons.filter((i) => {
      if (category !== 'all' && i.category !== category) return false
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [icons, search, category])

  const handlePick = (dataUrl: string) => {
    if (callback) callback(dataUrl)
    closeModal('iconPicker')
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('iconPicker')} maxWidth="max-w-4xl">
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-lg font-semibold text-slate-100">Pick an Icon</h2>
          <button
            onClick={() => closeModal('iconPicker')}
            className="text-slate-400 hover:text-slate-200"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-slate-800 shrink-0 flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-12">No icons found</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {filtered.map((icon) => (
                <button
                  key={icon.id}
                  onClick={() => handlePick(icon.data)}
                  className="group flex flex-col items-center bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500 rounded-lg p-2 transition-colors"
                >
                  <div className="w-full aspect-square bg-slate-800 rounded mb-1.5 flex items-center justify-center overflow-hidden">
                    <img src={icon.data} alt={icon.name} className="max-w-full max-h-full" />
                  </div>
                  <p className="text-xs text-slate-300 truncate w-full text-center">{icon.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  )
}
