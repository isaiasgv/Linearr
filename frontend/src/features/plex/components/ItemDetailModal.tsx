import { useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useAssign, useChannelAssignments } from '@/features/assignments/hooks'
import { usePlexItem, usePlexSeasons, usePlexEpisodes } from '@/features/plex/hooks'
import { PlexThumb } from './PlexThumb'
import type { PlexSeason } from '@/shared/types'

function EpisodeList({ seasonKey }: { seasonKey: string }) {
  const { data: episodes = [], isLoading } = usePlexEpisodes(seasonKey)

  if (isLoading) {
    return (
      <div className="py-4 flex justify-center">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <ul className="divide-y divide-slate-800">
      {episodes.map((ep) => (
        <li key={ep.rating_key} className="flex items-center gap-3 py-2 px-3">
          <span className="w-8 text-xs text-slate-500 text-right shrink-0">
            S{ep.season_number}E{ep.index}
          </span>
          <PlexThumb
            path={ep.thumb}
            alt={ep.title}
            className="w-14 h-8 object-cover rounded bg-slate-900 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-200 truncate">{ep.title}</p>
            {ep.duration_minutes != null && ep.duration_minutes > 0 && (
              <p className="text-xs text-slate-600">{ep.duration_minutes}m</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function SeasonRow({ season }: { season: PlexSeason }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-left transition-colors"
      >
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="text-sm text-slate-200 font-medium">{season.title}</span>
        <span className="ml-auto text-xs text-slate-500">{season.leaf_count} episodes</span>
      </button>
      {expanded && <EpisodeList seasonKey={season.rating_key} />}
    </div>
  )
}

export function ItemDetailModal() {
  const { modals, itemDetailRatingKey, closeModal, selectedChannel } = useUIStore()
  const open = modals.itemDetail

  const { data: item, isLoading } = usePlexItem(itemDetailRatingKey ?? '')
  const { data: seasons = [], isLoading: seasonsLoading } = usePlexSeasons(
    item?.type === 'show' ? (itemDetailRatingKey ?? '') : '',
  )

  const { data: channelAssignments = [] } = useChannelAssignments(selectedChannel?.number ?? 0)
  const assign = useAssign()

  const isAssigned = item && channelAssignments.some((a) => a.plex_rating_key === item.rating_key)

  function handleAssign() {
    if (!item || !selectedChannel) return
    assign.mutate({
      channel_number: selectedChannel.number,
      plex_rating_key: item.rating_key,
      plex_title: item.title,
      plex_type: item.type,
      plex_thumb: item.thumb,
      plex_year: item.year,
    })
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('itemDetail')} maxWidth="max-w-2xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : !item ? (
        <div className="flex items-center justify-center py-20 text-slate-500 text-sm">
          Item not found
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="flex gap-4 p-5 border-b border-slate-700">
            <div className="w-24 shrink-0 rounded-lg overflow-hidden bg-slate-900 aspect-[2/3]">
              <PlexThumb
                path={item.thumb}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100 leading-tight">
                    {item.title}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    {item.year && <span className="text-sm text-slate-400">{item.year}</span>}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        item.type === 'show'
                          ? 'bg-blue-900/40 text-blue-400'
                          : 'bg-purple-900/40 text-purple-400'
                      }`}
                    >
                      {item.type === 'show' ? 'TV Show' : 'Movie'}
                    </span>
                    {item.child_count !== undefined && item.type === 'show' && (
                      <span className="text-xs text-slate-500">
                        {item.child_count} season{item.child_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => closeModal('itemDetail')}
                  className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
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

              {item.summary && (
                <p className="text-xs text-slate-400 mt-2 line-clamp-3">{item.summary}</p>
              )}

              {selectedChannel && (
                <div className="mt-3">
                  {isAssigned ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-800 px-2.5 py-1 rounded-lg">
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      Assigned to Ch. {selectedChannel.number}
                    </span>
                  ) : (
                    <button
                      onClick={handleAssign}
                      disabled={assign.isPending}
                      className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors"
                    >
                      Assign to Ch. {selectedChannel.number}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Seasons */}
          {item.type === 'show' && (
            <div className="p-4 max-h-96 overflow-y-auto flex flex-col gap-2">
              {seasonsLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : seasons.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">No seasons found</p>
              ) : (
                seasons.map((season) => <SeasonRow key={season.rating_key} season={season} />)
              )}
            </div>
          )}
        </div>
      )}
    </ModalWrapper>
  )
}
