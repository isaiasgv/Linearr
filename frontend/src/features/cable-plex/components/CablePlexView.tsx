import { useState, useMemo, memo, useEffect } from 'react'
import Swal from 'sweetalert2'
import { useChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useUIStore } from '@/shared/store/ui.store'
import { tierColor } from '@/shared/components/ui/TierBadge'
import { Spinner } from '@/shared/components/ui/Spinner'
import type { Channel } from '@/shared/types'

// Preset lineup picker — only renders if user has dropped JSON files in ./data/presets/
interface PresetLineup {
  id: string
  name: string
  description: string
  channel_count: number
}

function PresetLineupButton() {
  const [presets, setPresets] = useState<PresetLineup[]>([])

  useEffect(() => {
    fetch('/api/presets/lineups')
      .then((r) => (r.ok ? r.json() : []))
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])

  if (presets.length === 0) return null

  const handleLoad = async (preset: PresetLineup) => {
    const { isConfirmed } = await Swal.fire({
      title: `Load ${preset.name}?`,
      html: `${preset.description || ''}<br/><br/>This will import <b>${preset.channel_count}</b> channels (merge mode — existing kept).`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Load',
      cancelButtonText: 'Cancel',
      background: '#1e293b',
      color: '#e2e8f0',
      confirmButtonColor: '#4f46e5',
    })
    if (!isConfirmed) return
    const res = await fetch(`/api/presets/lineups/${encodeURIComponent(preset.id)}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'merge' }),
    })
    if (res.ok) {
      const result = await res.json()
      await Swal.fire({
        icon: 'success',
        title: 'Preset Loaded',
        html: `Added <b>${result.stats.channels_added}</b> channels.`,
        background: '#1e293b',
        color: '#e2e8f0',
        confirmButtonColor: '#4f46e5',
      })
      window.location.reload()
    } else {
      await Swal.fire({
        icon: 'error',
        title: 'Failed to load preset',
        background: '#1e293b',
        color: '#e2e8f0',
      })
    }
  }

  return (
    <>
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => handleLoad(p)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 border border-indigo-600 text-white rounded-lg transition-colors"
          title={p.description || `${p.channel_count} channels`}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 2v20M2 12h20" />
          </svg>
          {p.name}
        </button>
      ))}
    </>
  )
}

type ViewMode = 'compact' | 'expanded'
type TierFilter = 'All' | 'Galaxy Main' | 'Classics' | 'Galaxy Premium'
type PosterSize = 'small' | 'medium' | 'large'
const POSTER_SIZES: Record<PosterSize, string> = {
  small: 'w-10 h-14',
  medium: 'w-14 h-20',
  large: 'w-20 h-28',
}

const TIER_FILTERS: TierFilter[] = ['All', 'Galaxy Main', 'Classics', 'Galaxy Premium']

interface ChannelCardCompactProps {
  channel: Channel
  assignments: import('@/shared/types').Assignment[]
  onClick: () => void
}

function ChannelCardCompact({ channel, assignments: items, onClick }: ChannelCardCompactProps) {
  const shows = items.filter((a) => a.plex_type === 'show')
  const movies = items.filter((a) => a.plex_type === 'movie')
  const thumbItems = items.filter((a) => a.plex_thumb).slice(0, 6)

  return (
    <button
      onClick={onClick}
      className="bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl overflow-hidden text-left transition-all hover:bg-slate-800 group flex flex-col"
    >
      {/* Poster collage strip */}
      <div className="h-20 relative overflow-hidden bg-slate-950">
        {thumbItems.length > 0 ? (
          <div className="absolute inset-0 flex">
            {thumbItems.map((a, i) => (
              <div key={i} className="flex-1 min-w-0 relative">
                <img
                  src={`/api/plex/thumb?path=${encodeURIComponent(a.plex_thumb!)}`}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-800">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
        {/* Channel badge overlaid */}
        <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5">
          {channel.icon && (
            <img src={channel.icon} alt="" className="w-7 h-7 rounded object-cover shadow" />
          )}
          <span
            className={`text-xs font-mono font-bold rounded px-1 py-0.5 shadow ${tierColor(channel.tier)}`}
          >
            {channel.number}
          </span>
          <span className="text-xs font-bold text-white truncate drop-shadow-lg">
            {channel.name}
          </span>
        </div>
        {/* Stats top-right */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {shows.length > 0 && (
            <span className="text-xs bg-blue-600/80 text-white rounded-full px-1.5 py-0 font-medium shadow">
              {shows.length} TV
            </span>
          )}
          {movies.length > 0 && (
            <span className="text-xs bg-yellow-600/80 text-white rounded-full px-1.5 py-0 font-medium shadow">
              {movies.length} Mov
            </span>
          )}
        </div>
      </div>
      {/* Show titles */}
      <div className="px-2.5 py-2 flex-1">
        {channel.vibe && <p className="text-xs text-slate-500 truncate mb-1">{channel.vibe}</p>}
        {shows.length > 0 ? (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
            {shows.map((a) => a.plex_title).join(' \u00B7 ')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No content assigned</p>
        ) : null}
      </div>
    </button>
  )
}

interface ChannelCardExpandedProps {
  channel: Channel
  assignments: import('@/shared/types').Assignment[]
  posterSize: PosterSize
  thumbFilter: 'all' | 'shows' | 'movies'
  onClick: () => void
}

const ChannelCardExpanded = memo(function ChannelCardExpanded({
  channel,
  assignments: items,
  posterSize,
  thumbFilter,
  onClick,
}: ChannelCardExpandedProps) {
  const shows = items.filter((a) => a.plex_type === 'show')
  const movies = items.filter((a) => a.plex_type === 'movie')
  const filteredItems = thumbFilter === 'shows' ? shows : thumbFilter === 'movies' ? movies : items
  const thumbItems = filteredItems.filter((a) => a.plex_thumb)

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="w-full bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl text-left transition-all hover:bg-slate-800 overflow-hidden cursor-pointer"
      style={{ contentVisibility: 'auto', containIntrinsicHeight: '80px' }}
    >
      <div className="flex items-stretch">
        {/* Channel info */}
        <div className="p-3 flex items-center gap-3 shrink-0 w-48">
          {channel.icon ? (
            <div className="relative shrink-0">
              <img
                src={channel.icon}
                alt=""
                className="w-11 h-11 rounded-lg object-cover bg-slate-950"
              />
              <span
                className={`absolute -bottom-1 -right-1 text-[10px] font-mono font-bold rounded px-1 py-0 leading-tight shadow ${tierColor(channel.tier)}`}
              >
                {channel.number}
              </span>
            </div>
          ) : (
            <span
              className={`text-sm font-mono font-bold rounded-lg w-11 h-10 flex items-center justify-center shrink-0 ${tierColor(channel.tier)}`}
            >
              {channel.number}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{channel.name}</p>
            <p className="text-xs text-slate-500 truncate">{channel.vibe || ''}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {shows.length > 0 && (
                <span className="text-xs bg-blue-900/40 text-blue-300 rounded-full px-1.5 py-0">
                  {shows.length} TV
                </span>
              )}
              {movies.length > 0 && (
                <span className="text-xs bg-yellow-900/40 text-yellow-300 rounded-full px-1.5 py-0">
                  {movies.length} Mov
                </span>
              )}
              {items.length === 0 && <span className="text-xs text-slate-600">Empty</span>}
            </div>
          </div>
        </div>
        {/* Poster strip — scrollable, shows ALL items */}
        <div
          className="flex-1 flex gap-1 items-center px-2 overflow-x-auto py-2"
          style={{ scrollbarWidth: 'thin' }}
          onClick={(e) => e.stopPropagation()}
        >
          {thumbItems.map((a, i) => (
            <div
              key={a.plex_rating_key || i}
              className={`${POSTER_SIZES[posterSize]} shrink-0 rounded overflow-hidden bg-slate-800 relative`}
              title={a.plex_title}
            >
              <img
                src={`/api/plex/thumb?path=${encodeURIComponent(a.plex_thumb!)}`}
                alt={a.plex_title}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
          ))}
          {thumbItems.length === 0 && (
            <span className="text-xs text-slate-700 italic">No posters</span>
          )}
        </div>
      </div>
    </div>
  )
})

export function CablePlexView() {
  const { data: channels = [], isLoading: loadingChannels } = useChannels()
  const { data: assignments = {} } = useAssignments()
  const selectChannel = useUIStore((s) => s.selectChannel)
  const setActiveView = useUIStore((s) => s.setActiveView)

  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<TierFilter>('All')
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  const [posterSize, setPosterSize] = useState<PosterSize>('medium')
  const [thumbFilter, setThumbFilter] = useState<'all' | 'shows' | 'movies'>('all')

  const filtered = useMemo(() => {
    return channels.filter((ch) => {
      const matchesTier = tierFilter === 'All' || ch.tier === tierFilter
      const matchesSearch =
        !search ||
        ch.name.toLowerCase().includes(search.toLowerCase()) ||
        String(ch.number).includes(search)
      return matchesTier && matchesSearch
    })
  }, [channels, tierFilter, search])

  const handleChannelClick = (channel: Channel) => {
    selectChannel(channel)
    setActiveView('channel')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Cable Plex</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {filtered.length} of {channels.length} channel{channels.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none"
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
              placeholder="Search channels…"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* View toggle */}
          <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 ml-auto">
            <button
              onClick={() => setViewMode('compact')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'compact'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Compact
            </button>
            <button
              onClick={() => setViewMode('expanded')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'expanded'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              Expanded
            </button>
          </div>

          {/* Expanded view controls */}
          {viewMode === 'expanded' && (
            <>
              {/* Content type filter */}
              <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                {[
                  { v: 'all' as const, l: 'All' },
                  { v: 'shows' as const, l: 'Shows' },
                  { v: 'movies' as const, l: 'Movies' },
                ].map(({ v, l }) => (
                  <button
                    key={v}
                    onClick={() => setThumbFilter(v)}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      thumbFilter === v
                        ? 'bg-slate-600 text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {/* Poster size toggle */}
              <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                {(['small', 'medium', 'large'] as PosterSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPosterSize(s)}
                    title={s.charAt(0).toUpperCase() + s.slice(1)}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      posterSize === s
                        ? 'bg-slate-600 text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {s.charAt(0).toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Export / Import */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={async () => {
              const res = await fetch('/api/export/lineup')
              const data = await res.json()
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `linearr-lineup-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export Lineup
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Import Lineup
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const text = await file.text()
                const data = JSON.parse(text)
                const { isConfirmed } = await Swal.fire({
                  title: 'Import Mode',
                  text: 'Replace entire lineup or merge with existing?',
                  icon: 'question',
                  showCancelButton: true,
                  confirmButtonText: 'Replace',
                  cancelButtonText: 'Merge',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  confirmButtonColor: '#4f46e5',
                })
                const mode = isConfirmed ? 'replace' : 'merge'
                const res = await fetch('/api/import/lineup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mode, data }),
                })
                if (res.ok) {
                  const result = await res.json()
                  await Swal.fire({
                    icon: 'success',
                    title: 'Import Complete',
                    html: `<b>${mode}</b>: ${result.stats.channels_added} channels, ${result.stats.assignments_added} assignments, ${result.stats.blocks_added} blocks`,
                    background: '#1e293b',
                    color: '#e2e8f0',
                    confirmButtonColor: '#4f46e5',
                  })
                  window.location.reload()
                } else {
                  await Swal.fire({
                    icon: 'error',
                    title: 'Import Failed',
                    background: '#1e293b',
                    color: '#e2e8f0',
                  })
                }
                e.target.value = ''
              }}
            />
          </label>
          <PresetLineupButton />
        </div>

        {/* Tier filter tabs */}
        <div className="flex gap-1 mt-3 flex-wrap">
          {TIER_FILTERS.map((tier) => (
            <button
              key={tier}
              onClick={() => setTierFilter(tier)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                tierFilter === tier
                  ? tier === 'All'
                    ? 'bg-slate-700 border-slate-500 text-slate-100'
                    : tierColor(tier as Channel['tier'])
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500'
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      {/* Channel grid / list */}
      <div className="flex-1 overflow-y-auto p-6">
        {loadingChannels ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-slate-400 text-sm">No channels match your filter</p>
            <button
              onClick={() => {
                setSearch('')
                setTierFilter('All')
              }}
              className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : viewMode === 'compact' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((ch) => (
              <ChannelCardCompact
                key={ch.number}
                channel={ch}
                assignments={assignments[ch.number] ?? []}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((ch) => (
              <ChannelCardExpanded
                key={ch.number}
                channel={ch}
                assignments={assignments[ch.number] ?? []}
                posterSize={posterSize}
                thumbFilter={thumbFilter}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
