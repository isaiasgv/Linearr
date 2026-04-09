import { useState } from 'react'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import {
  useTunarrChannels,
  useTunarrLinks,
  useTunarrCollectionLinks,
  useLinkTunarrChannel,
  useUnlinkTunarrChannel,
  useUnlinkTunarrCollection,
  usePushSchedule,
  useSyncCollections,
  useCreateTunarrChannel,
} from '@/features/tunarr/hooks'
import { useChannels } from '@/features/channels/hooks'

interface TunarrTabProps {
  channelNumber: number
}

export function TunarrTab({ channelNumber }: TunarrTabProps) {
  const { data: channels = [] } = useChannels()
  const { data: tunarrChannels = [], isLoading: loadingTunarr } = useTunarrChannels()
  const { data: links = [] } = useTunarrLinks()
  const { data: collectionLinks = [] } = useTunarrCollectionLinks()

  const linkChannel = useLinkTunarrChannel()
  const unlinkChannel = useUnlinkTunarrChannel()
  const unlinkCollection = useUnlinkTunarrCollection()
  const pushSchedule = usePushSchedule()
  const syncCollections = useSyncCollections()
  const createTunarrChannel = useCreateTunarrChannel()
  const openModal = useUIStore((s) => s.openModal)

  const [selectedTunarrId, setSelectedTunarrId] = useState('')

  const link = links.find((l) => l.channel_number === channelNumber)
  const movieCollectionLink = collectionLinks.find(
    (cl) => cl.channel_number === channelNumber && cl.plex_type === 'movie',
  )
  const showCollectionLink = collectionLinks.find(
    (cl) => cl.channel_number === channelNumber && cl.plex_type === 'show',
  )

  const localChannel = channels.find((c) => c.number === channelNumber)

  const handleLink = () => {
    if (!selectedTunarrId) return
    linkChannel.mutate({ channel_number: channelNumber, tunarr_id: selectedTunarrId })
    setSelectedTunarrId('')
  }

  const handleCreateAndLink = () => {
    if (!localChannel) return
    createTunarrChannel.mutate(
      { name: localChannel.name, number: localChannel.number },
      {
        onSuccess: (created) => {
          linkChannel.mutate({
            channel_number: channelNumber,
            tunarr_id: created.id,
          })
        },
      },
    )
  }

  const handlePushPreview = () => {
    pushSchedule.mutate(
      { channelNumber, preview: true },
      {
        onSuccess: (data) => {
          openModal('tunarrPreview', { tunarrPreviewData: data })
        },
      },
    )
  }

  const handleLinkCollection = (plexType: 'movie' | 'show') => {
    // Open a collection picker. Pass type in modal data.
    openModal('tunarrCollectionPicker', { collectionPickerType: plexType } as never)
  }

  return (
    <div className="space-y-6 p-4">
      {/* Linked Tunarr Channel */}
      <section className="bg-slate-900 border border-slate-700 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Tunarr Channel Link</h3>

        {link ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">{link.tunarr_name ?? link.tunarr_id}</p>
                {link.tunarr_number != null && (
                  <p className="text-xs text-slate-500">CH {link.tunarr_number}</p>
                )}
              </div>
              <button
                onClick={() => unlinkChannel.mutate(channelNumber)}
                disabled={unlinkChannel.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-60 border border-red-800/50 text-red-400 rounded-lg text-xs font-medium transition-colors"
              >
                {unlinkChannel.isPending ? <Spinner size="sm" /> : 'Unlink'}
              </button>
            </div>

            {/* Push/Sync actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handlePushPreview}
                disabled={pushSchedule.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {pushSchedule.isPending && <Spinner size="sm" />}
                Push Schedule
              </button>
              <button
                onClick={() => syncCollections.mutate(channelNumber)}
                disabled={syncCollections.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-slate-100 rounded-lg text-xs font-medium transition-colors"
              >
                {syncCollections.isPending && <Spinner size="sm" />}
                Sync Collections
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {loadingTunarr ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Spinner size="sm" />
                Loading Tunarr channels…
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <select
                    value={selectedTunarrId}
                    onChange={(e) => setSelectedTunarrId(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select Tunarr channel…</option>
                    {tunarrChannels.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        CH {tc.number} — {tc.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleLink}
                    disabled={!selectedTunarrId || linkChannel.isPending}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {linkChannel.isPending ? <Spinner size="sm" /> : 'Link'}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <div className="flex-1 h-px bg-slate-700" />
                  <span className="text-xs">or</span>
                  <div className="flex-1 h-px bg-slate-700" />
                </div>
                <button
                  onClick={handleCreateAndLink}
                  disabled={createTunarrChannel.isPending || linkChannel.isPending}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-800/40 hover:bg-emerald-800/60 disabled:opacity-60 border border-emerald-700/50 text-emerald-300 rounded-lg text-sm font-medium transition-colors w-full justify-center"
                >
                  {(createTunarrChannel.isPending || linkChannel.isPending) && <Spinner size="sm" />}
                  Create New Tunarr Channel
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* Collections */}
      <section className="bg-slate-900 border border-slate-700 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Collection Links</h3>
        <div className="space-y-3">
          {/* Movie Collection */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-12">Movies</span>
              {movieCollectionLink ? (
                <span className="text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded truncate max-w-[200px]">
                  {movieCollectionLink.tunarr_collection_name ?? movieCollectionLink.tunarr_collection_id}
                </span>
              ) : (
                <span className="text-xs text-slate-500 italic">Not linked</span>
              )}
            </div>
            {movieCollectionLink ? (
              <button
                onClick={() =>
                  unlinkCollection.mutate({ channelNumber, plexType: 'movie' })
                }
                disabled={unlinkCollection.isPending}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-60 transition-colors shrink-0"
              >
                Unlink
              </button>
            ) : (
              <button
                onClick={() => handleLinkCollection('movie')}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Link Collection
              </button>
            )}
          </div>

          {/* Show Collection */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-12">Shows</span>
              {showCollectionLink ? (
                <span className="text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded truncate max-w-[200px]">
                  {showCollectionLink.tunarr_collection_name ?? showCollectionLink.tunarr_collection_id}
                </span>
              ) : (
                <span className="text-xs text-slate-500 italic">Not linked</span>
              )}
            </div>
            {showCollectionLink ? (
              <button
                onClick={() =>
                  unlinkCollection.mutate({ channelNumber, plexType: 'show' })
                }
                disabled={unlinkCollection.isPending}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-60 transition-colors shrink-0"
              >
                Unlink
              </button>
            ) : (
              <button
                onClick={() => handleLinkCollection('show')}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Link Collection
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
