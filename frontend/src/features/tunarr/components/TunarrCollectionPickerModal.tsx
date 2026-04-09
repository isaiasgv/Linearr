import { useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useTunarrSmartCollections, useLinkTunarrCollection } from '@/features/tunarr/hooks'

export function TunarrCollectionPickerModal() {
  const { modals, closeModal, selectedChannel, collectionPickerType } = useUIStore()
  const open = modals.tunarrCollectionPicker

  const [search, setSearch] = useState('')

  const { data: smartCollections = [], isLoading } = useTunarrSmartCollections()
  const linkCollection = useLinkTunarrCollection()

  const filtered = smartCollections.filter((sc) =>
    sc.name.toLowerCase().includes(search.toLowerCase()),
  )

  function handleLink(collection: { uuid: string; name: string }) {
    if (!selectedChannel || !collectionPickerType) return
    linkCollection.mutate(
      {
        channel_number: selectedChannel.number,
        plex_type: collectionPickerType,
        tunarr_collection_id: collection.uuid,
        tunarr_collection_name: collection.name,
      },
      { onSuccess: () => closeModal('tunarrCollectionPicker') },
    )
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('tunarrCollectionPicker')} maxWidth="max-w-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Link Tunarr Smart Collection</h2>
          {collectionPickerType && (
            <p className="text-xs text-slate-500 mt-0.5">
              Linking {collectionPickerType === 'movie' ? 'movie' : 'show'} collection
            </p>
          )}
        </div>
        <button
          onClick={() => closeModal('tunarrCollectionPicker')}
          className="text-slate-500 hover:text-slate-300 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-5 py-3 border-b border-slate-800">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter smart collections..."
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
          <div className="text-center py-12">
            <p className="text-sm text-slate-500">
              {search ? 'No collections match your search' : 'No smart collections found in Tunarr'}
            </p>
            <p className="text-xs text-slate-600 mt-2">
              Generate Plex collections first, then use "Sync Collections" to create them in Tunarr.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {filtered.map((sc) => (
              <li
                key={sc.uuid}
                className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/50 transition"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{sc.name}</p>
                  <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{sc.uuid}</p>
                </div>
                <button
                  onClick={() => handleLink(sc)}
                  disabled={linkCollection.isPending}
                  className="shrink-0 ml-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs rounded-lg font-medium transition"
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
