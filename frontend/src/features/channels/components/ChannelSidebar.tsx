import { useState, useMemo } from 'react'
import { useUIStore, type TierFilter } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { tierColor } from '@/shared/components/ui/TierBadge'
import type { Channel } from '@/shared/types'

const TIER_FILTERS: { label: string; value: TierFilter }[] = [
  { label: 'All', value: 'All' },
  { label: 'Main', value: 'Galaxy Main' },
  { label: 'Classics', value: 'Classics' },
  { label: 'Premium', value: 'Galaxy Premium' },
]

function tierNumberColor(tier: Channel['tier']): string {
  switch (tier) {
    case 'Galaxy Main':
      return 'bg-blue-700 text-blue-100'
    case 'Classics':
      return 'bg-purple-700 text-purple-100'
    case 'Galaxy Premium':
      return 'bg-amber-700 text-amber-100'
  }
}

export function ChannelSidebar() {
  const {
    selectedChannel,
    selectChannel,
    tierFilter,
    setTierFilter,
    activeView,
    setActiveView,
    openModal,
    setSidebarOpen,
  } = useUIStore()

  const { data: channels = [] } = useChannels()
  const { data: assignmentsMap = {} } = useAssignments()
  const { data: tunarrLinks = [] } = useTunarrLinks()

  const tunarrLinkedCount = tunarrLinks.length

  const [search, setSearch] = useState('')

  const filteredChannels = useMemo(
    () =>
      channels
        .filter((c) => tierFilter === 'All' || c.tier === tierFilter)
        .filter((c) => {
          if (!search) return true
          const q = search.toLowerCase()
          return c.name.toLowerCase().includes(q) || String(c.number).includes(q)
        }),
    [channels, tierFilter, search],
  )

  return (
    <>
      {/* Mobile-only header with close button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 md:hidden shrink-0">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Menu</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          aria-label="Close menu"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Tier filter tabs */}
      <div className="p-3 border-b border-slate-800 shrink-0">
        <div className="flex gap-1 bg-slate-950 rounded-lg p-1">
          {TIER_FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setTierFilter(value)}
              className={`flex-1 text-xs py-1 rounded-md font-medium transition-colors ${
                tierFilter === value
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* View buttons */}
      <div className="px-3 py-2 border-b border-slate-800 flex flex-col gap-1.5 shrink-0">
        <button
          onClick={() => setActiveView('cableplex')}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'cableplex'
              ? 'bg-amber-900/40 border border-amber-700 text-amber-300'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
          }`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="2" y="7" width="20" height="15" rx="2" />
            <path d="M15 10l-4 4 4 4" />
          </svg>
          Cable Plex
        </button>

        <button
          onClick={() => setActiveView('plex')}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'plex'
              ? 'bg-orange-900/40 border border-orange-700 text-orange-300'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
          }`}
        >
          <img src="/plex.svg" alt="Plex" className="w-4 h-4 rounded-sm" />
          Plex
        </button>

        <button
          onClick={() => setActiveView('icons')}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'icons'
              ? 'bg-purple-900/40 border border-purple-700 text-purple-300'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
          }`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          Icons
        </button>

        <button
          onClick={() => setActiveView('generic')}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'generic'
              ? 'bg-indigo-900/40 border border-indigo-700 text-indigo-300'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
          }`}
        >
          <svg
            className="w-4 h-4"
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
          Generic Blocks
        </button>

        <button
          onClick={() => setActiveView('tunarr')}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'tunarr'
              ? 'bg-emerald-900/40 border border-emerald-700 text-emerald-300'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
          }`}
        >
          <span className="flex items-center gap-2">
            <img src="/tunarr.svg" alt="Tunarr" className="w-4 h-4 rounded-sm" />
            Tunarr
          </span>
          {tunarrLinkedCount > 0 && (
            <span className="text-xs bg-emerald-700 text-emerald-100 rounded-full px-1.5 py-0.5 font-semibold">
              {tunarrLinkedCount}
            </span>
          )}
        </button>
      </div>

      {/* Add channel button */}
      <div className="px-3 py-2 border-b border-slate-800 shrink-0">
        <button
          onClick={() => openModal('channelForm', { editingChannel: null })}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-slate-600 hover:border-indigo-500 hover:text-indigo-400 text-slate-500 rounded-lg text-sm transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Channel
        </button>
      </div>

      {/* Channel search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredChannels.length === 0 && (
          <p className="text-center text-xs text-slate-600 py-8">No channels</p>
        )}
        {filteredChannels.map((ch) => {
          const assignments = assignmentsMap[ch.number] ?? []
          const isLinked = tunarrLinks.some((l) => l.channel_number === ch.number)
          const isSelected = selectedChannel?.number === ch.number

          return (
            <button
              key={ch.number}
              onClick={() => selectChannel(ch)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'bg-slate-700 border-l-2 border-indigo-500'
                  : 'border-l-2 border-transparent hover:bg-slate-800'
              }`}
            >
              <span
                className={`flex-shrink-0 w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${tierNumberColor(ch.tier)}`}
              >
                {ch.number}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-100 truncate">{ch.name}</span>
                  {isLinked && (
                    <span
                      className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400"
                      title="Linked to Tunarr"
                    />
                  )}
                </div>
                {ch.vibe && <p className="text-xs text-slate-500 truncate">{ch.vibe}</p>}
              </div>

              {assignments.length > 0 && (
                <span
                  className={`flex-shrink-0 text-xs rounded-full px-1.5 py-0.5 font-medium border ${tierColor(ch.tier)}`}
                >
                  {assignments.length}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
