import { useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useAssign, useChannelAssignments } from '@/features/assignments/hooks'
import { usePlexItem, usePlexSeasons, usePlexEpisodes, useRateItem } from '@/features/plex/hooks'
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
  const rateItem = useRateItem()

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

              {/* Genre pills */}
              {item.genres && item.genres.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {item.genres.map((g) => (
                    <span key={g} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Quality badge + subtitles */}
              {item.media_info && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {item.media_info.resolution && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 border border-indigo-800/50 text-indigo-300 font-mono font-medium">
                      {item.media_info.resolution === '4k' ? '4K' : `${item.media_info.resolution}p`}
                    </span>
                  )}
                  {item.media_info.video_codec && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">
                      {item.media_info.video_codec.toUpperCase()}
                    </span>
                  )}
                  {item.media_info.audio_codec && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">
                      {item.media_info.audio_codec.toUpperCase()}
                      {item.media_info.audio_channels ? ` ${item.media_info.audio_channels === 6 ? '5.1' : item.media_info.audio_channels === 8 ? '7.1' : `${item.media_info.audio_channels}ch`}` : ''}
                    </span>
                  )}
                  {item.subtitles && item.subtitles.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-800/50 text-amber-400">
                      Subs: {item.subtitles.slice(0, 3).join(', ')}{item.subtitles.length > 3 ? ` +${item.subtitles.length - 3}` : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Star rating */}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = (item.user_rating ?? 0) >= star * 2
                    const half = !filled && (item.user_rating ?? 0) >= star * 2 - 1
                    return (
                      <button
                        key={star}
                        onClick={() => {
                          const newRating = star * 2
                          rateItem.mutate({
                            ratingKey: item.rating_key,
                            rating: item.user_rating === newRating ? 0 : newRating,
                          })
                        }}
                        className="text-amber-400 hover:scale-110 transition-transform"
                        title={`${star} star${star > 1 ? 's' : ''}`}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill={filled || half ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5}>
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </button>
                    )
                  })}
                </div>
                {item.audience_rating && (
                  <span className="text-[10px] text-slate-500">
                    Audience: {item.audience_rating.toFixed(1)}
                  </span>
                )}
                {item.rating && (
                  <span className="text-[10px] text-slate-500">
                    Critic: {item.rating.toFixed(1)}
                  </span>
                )}
              </div>

              {/* Play button — opens in Plex web app (works local + remote) */}
              {item.plex_web_url && (
                <div className="mt-2">
                  <a
                    href={item.plex_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Play on Plex
                  </a>
                </div>
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
