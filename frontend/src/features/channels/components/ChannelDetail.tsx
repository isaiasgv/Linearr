import { useState, useRef, useEffect } from 'react'
import { useUIStore, type ActiveChannelTab } from '@/shared/store/ui.store'
import { useChannels, useDeleteChannel } from '@/features/channels/hooks'
import { useChannelAssignments } from '@/features/assignments/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { TierBadge, tierColor } from '@/shared/components/ui/TierBadge'
import { confirmDialog } from '@/shared/components/ui'
import { tierNumberColor } from '@/features/channels/utils'
import { ContentTab } from '@/features/content/components/ContentTab'
import { BlocksTab } from '@/features/blocks/components/BlocksTab'
import { TunarrTab } from '@/features/tunarr/components/TunarrTab'

const TABS: { label: string; value: ActiveChannelTab }[] = [
  { label: 'Content', value: 'content' },
  { label: 'Blocks', value: 'blocks' },
  { label: 'Tunarr', value: 'tunarr' },
]

export function ChannelDetail() {
  const { selectedChannel, activeChannelTab, setActiveChannelTab, openModal, selectChannel } =
    useUIStore()
  const deleteChannel = useDeleteChannel()
  const { data: channels } = useChannels()
  const { data: assignments = [] } = useChannelAssignments(selectedChannel?.number ?? 0)
  const { data: tunarrLinks = [] } = useTunarrLinks()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [])

  if (!selectedChannel) return null

  // Resolve the live channel from the query cache — the store snapshot goes
  // stale after edits via ChannelFormModal.
  const ch = channels?.find((c) => c.number === selectedChannel.number) ?? selectedChannel
  const tunarrLink = tunarrLinks.find((l) => l.channel_number === ch.number)

  async function handleDelete() {
    setMenuOpen(false)
    const confirmed = await confirmDialog({
      title: `Delete channel ${ch.number} – ${ch.name}?`,
      text: 'This cannot be undone.',
      danger: true,
    })
    if (!confirmed) return
    deleteChannel.mutate(ch.number, {
      onSuccess: () => selectChannel(null),
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header — single compact row: identity · tabs · actions */}
      <div className="flex-shrink-0 px-4 md:px-6 py-2.5 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Identity */}
          <div className="flex items-center gap-2.5 min-w-0">
            {ch.icon ? (
              <div className="relative shrink-0">
                <img
                  src={ch.icon}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border border-slate-700"
                />
                <span
                  className={`absolute -bottom-1 -right-1 text-[9px] font-mono font-bold rounded px-1 leading-tight shadow ${tierNumberColor(ch.tier)}`}
                >
                  {ch.number}
                </span>
              </div>
            ) : (
              <span
                className={`shrink-0 w-9 h-9 rounded-lg text-sm font-bold flex items-center justify-center ${tierNumberColor(ch.tier)}`}
              >
                {ch.number}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-100 truncate">{ch.name}</h2>
                <TierBadge tier={ch.tier} />
                <span
                  className={`text-xs font-medium border rounded px-1.5 py-0.5 ${tierColor(ch.tier)}`}
                >
                  {assignments.length} assigned
                </span>
                {tunarrLink && (
                  <span className="text-xs px-2 py-0.5 rounded border bg-emerald-900/40 text-emerald-300 border-emerald-700">
                    Tunarr #{tunarrLink.tunarr_number ?? '?'}
                  </span>
                )}
                {ch.vibe && (
                  <span className="hidden lg:inline text-xs text-slate-500 italic truncate">
                    {ch.vibe}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tab strip */}
          <div className="flex gap-1 ml-auto">
            {TABS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setActiveChannelTab(value)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeChannelTab === value
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Actions overflow menu — ml-auto keeps it (and the right-anchored
              dropdown) at the pane's right edge when the header wraps, so the
              menu isn't clipped by the content pane's overflow-hidden */}
          <div className="relative shrink-0 ml-auto" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Channel actions"
              title="Channel actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('iconEditor')
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5 text-purple-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  {ch.icon ? 'Edit Icon' : 'Add Icon'}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('channelForm', { editingChannel: ch })
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit Channel
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={handleDelete}
                  disabled={deleteChannel.isPending}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  </svg>
                  Delete Channel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeChannelTab === 'content' && <ContentTab channelNumber={ch.number} />}
        {activeChannelTab === 'blocks' && <BlocksTab channelNumber={ch.number} />}
        {activeChannelTab === 'tunarr' && <TunarrTab channelNumber={ch.number} />}
      </div>
    </div>
  )
}
