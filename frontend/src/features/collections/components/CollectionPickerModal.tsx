import { useState, useEffect } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { usePlexCollections } from '@/features/plex/hooks'
import { useLinkCollection } from '@/features/collections/hooks'
import { PlexThumb } from '@/features/plex/components/PlexThumb'

export function CollectionPickerModal() {
  const { modals, closeModal, selectedChannel, collectionPickerType } = useUIStore()
  const open = modals.collectionPicker

  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const { data: collections = [], isLoading } = usePlexCollections()
  const linkCollection = useLinkCollection()

  const filtered = collections.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(search.toLowerCase())
    const matchesType = !collectionPickerType || c.type === collectionPickerType
    return matchesSearch && matchesType
  })

  function handleLink(ratingKey: string, title: string, type: 'movie' | 'show') {
    if (!selectedChannel) return
    linkCollection.mutate(
      {
        channelNumber: selectedChannel.number,
        plex_type: type,
        collection_rating_key: ratingKey,
        collection_title: title,
      },
      { onSuccess: () => closeModal('collectionPicker') },
    )
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('collectionPicker')} maxWidth="max-w-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Link Collection</h2>
          {collectionPickerType && (
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {collectionPickerType === 'movie' ? 'movie' : 'show'} collections
            </p>
          )}
        </div>
        <button
          onClick={() => closeModal('collectionPicker')}
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

      {/* Search */}
      <div className="px-5 py-3 border-b border-slate-800">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter collections…"
            autoFocus
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-12">
            {search ? 'No collections match your search' : 'No collections found'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {filtered.map((col) => (
              <li
                key={col.rating_key}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-800/50 transition-colors"
              >
                <div className="w-10 h-14 rounded bg-slate-900 overflow-hidden shrink-0">
                  <PlexThumb
                    path={col.thumb}
                    alt={col.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{col.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">
                      {col.child_count} item{col.child_count !== 1 ? 's' : ''}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        col.type === 'show'
                          ? 'bg-blue-900/40 text-blue-400'
                          : 'bg-purple-900/40 text-purple-400'
                      }`}
                    >
                      {col.type === 'show' ? 'Shows' : 'Movies'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleLink(col.rating_key, col.title, col.type)}
                  disabled={linkCollection.isPending}
                  className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs rounded-lg font-medium transition-colors"
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalWrapper>
  )
}
