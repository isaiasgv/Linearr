import { useState, useMemo, type ReactNode } from 'react'
import { useUIStore, type TierFilter } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { usePlexSessions } from '@/features/plex/hooks'
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

/** A sidebar navigation button that adapts between full and collapsed (icon-rail) modes. */
function NavButton({
  icon,
  label,
  active,
  accent,
  collapsed,
  onClick,
  trailing,
  collapsedBadge,
}: {
  icon: ReactNode
  label: string
  active: boolean
  accent: string
  collapsed: boolean
  onClick: () => void
  trailing?: ReactNode
  collapsedBadge?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`relative w-full flex items-center rounded-lg text-sm font-medium transition-colors ${
        collapsed ? 'justify-center px-0 py-2' : 'gap-2 px-3 py-2'
      } ${
        active
          ? accent
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
      }`}
    >
      <span className="shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {!collapsed && trailing}
      {collapsed && collapsedBadge}
    </button>
  )
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
    sidebarCollapsed,
  } = useUIStore()

  const { data: channels = [] } = useChannels()
  const { data: assignmentsMap = {} } = useAssignments()
  const { data: tunarrLinks = [] } = useTunarrLinks()
  const { data: plexSessions = [] } = usePlexSessions()

  const tunarrLinkedCount = tunarrLinks.length
  const collapsed = sidebarCollapsed

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

  // When collapsed we don't filter by search (no input visible) — show all in current tier.
  const visibleChannels = collapsed
    ? channels.filter((c) => tierFilter === 'All' || c.tier === tierFilter)
    : filteredChannels

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

      {/* Tier filter tabs — hidden in collapsed rail */}
      {!collapsed && (
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
      )}

      {/* View buttons */}
      <div className="px-2 py-2 border-b border-slate-800 flex flex-col gap-1.5 shrink-0">
        <NavButton
          collapsed={collapsed}
          active={activeView === 'cableplex'}
          accent="bg-amber-900/40 border border-amber-700 text-amber-300"
          onClick={() => setActiveView('cableplex')}
          label="Cable Plex"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <path d="M15 10l-4 4 4 4" />
            </svg>
          }
        />

        <NavButton
          collapsed={collapsed}
          active={activeView === 'plex'}
          accent="bg-orange-900/40 border border-orange-700 text-orange-300"
          onClick={() => setActiveView('plex')}
          label="Plex"
          icon={<img src="/plex.svg" alt="Plex" className="w-4 h-4 rounded-sm" />}
          trailing={
            plexSessions.length > 0 ? (
              <span className="ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400">{plexSessions.length}</span>
              </span>
            ) : undefined
          }
          collapsedBadge={
            plexSessions.length > 0 ? (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            ) : undefined
          }
        />

        <NavButton
          collapsed={collapsed}
          active={activeView === 'icons'}
          accent="bg-purple-900/40 border border-purple-700 text-purple-300"
          onClick={() => setActiveView('icons')}
          label="Icons"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          }
        />

        <NavButton
          collapsed={collapsed}
          active={activeView === 'generic'}
          accent="bg-indigo-900/40 border border-indigo-700 text-indigo-300"
          onClick={() => setActiveView('generic')}
          label="Generic Blocks"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          }
        />

        <NavButton
          collapsed={collapsed}
          active={activeView === 'tunarr'}
          accent="bg-emerald-900/40 border border-emerald-700 text-emerald-300"
          onClick={() => setActiveView('tunarr')}
          label="Tunarr"
          icon={<img src="/tunarr.svg" alt="Tunarr" className="w-4 h-4 rounded-sm" />}
          trailing={
            tunarrLinkedCount > 0 ? (
              <span className="ml-auto text-xs bg-emerald-700 text-emerald-100 rounded-full px-1.5 py-0.5 font-semibold">
                {tunarrLinkedCount}
              </span>
            ) : undefined
          }
          collapsedBadge={
            tunarrLinkedCount > 0 ? (
              <span className="absolute top-0.5 right-0.5 text-[9px] leading-none bg-emerald-700 text-emerald-100 rounded-full px-1 py-0.5 font-semibold">
                {tunarrLinkedCount}
              </span>
            ) : undefined
          }
        />
      </div>

      {/* Add channel button */}
      <div className="px-2 py-2 border-b border-slate-800 shrink-0">
        <button
          onClick={() => openModal('channelForm', { editingChannel: null })}
          title={collapsed ? 'Add Channel' : undefined}
          className={`w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 hover:border-indigo-500 hover:text-indigo-400 text-slate-500 rounded-lg text-sm transition-colors ${
            collapsed ? 'px-0 py-2' : 'px-3 py-2'
          }`}
        >
          <svg
            className="w-4 h-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {!collapsed && 'Add Channel'}
        </button>
      </div>

      {/* Channel search — hidden in collapsed rail */}
      {!collapsed && (
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
              aria-label="Search channels"
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
      )}

      {/* Channel list */}
      <div className={`flex-1 overflow-y-auto py-1 ${collapsed ? 'px-1.5' : ''}`}>
        {visibleChannels.length === 0 && !collapsed && (
          <p className="text-center text-xs text-slate-600 py-8">No channels</p>
        )}
        {visibleChannels.map((ch) => {
          const assignments = assignmentsMap[ch.number] ?? []
          const isLinked = tunarrLinks.some((l) => l.channel_number === ch.number)
          const isSelected = selectedChannel?.number === ch.number

          if (collapsed) {
            return (
              <button
                key={ch.number}
                onClick={() => selectChannel(ch)}
                title={`${ch.number} – ${ch.name}${assignments.length ? ` · ${assignments.length} assigned` : ''}`}
                className={`relative w-full flex justify-center py-1.5 rounded-lg transition-colors ${
                  isSelected ? 'bg-slate-700' : 'hover:bg-slate-800'
                }`}
              >
                <div className="relative">
                  {ch.icon ? (
                    <img
                      src={ch.icon}
                      alt=""
                      className="w-8 h-8 rounded-lg object-cover bg-slate-900"
                    />
                  ) : (
                    <span
                      className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${tierNumberColor(ch.tier)}`}
                    >
                      {ch.number}
                    </span>
                  )}
                  {isLinked && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900"
                      title="Linked to Tunarr"
                    />
                  )}
                </div>
              </button>
            )
          }

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
              {ch.icon ? (
                <div className="relative shrink-0">
                  <img
                    src={ch.icon}
                    alt=""
                    className="w-8 h-8 rounded-lg object-cover bg-slate-900"
                  />
                  <span
                    className={`absolute -bottom-1 -right-1 text-[9px] font-mono font-bold rounded px-1 leading-tight shadow ${tierNumberColor(ch.tier)}`}
                  >
                    {ch.number}
                  </span>
                </div>
              ) : (
                <span
                  className={`flex-shrink-0 w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${tierNumberColor(ch.tier)}`}
                >
                  {ch.number}
                </span>
              )}

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
