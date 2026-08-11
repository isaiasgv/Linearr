import { useState, useRef, useEffect } from 'react'
import { useUIStore, type ActiveChannelTab } from '@/shared/store/ui.store'
import { useChannels, useDeleteChannel } from '@/features/channels/hooks'
import { useChannelAssignments } from '@/features/assignments/hooks'
import { useChannelCollections, useBuildChannelCollections } from '@/features/collections/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { useAssignIconToChannel } from '@/features/icons/hooks'
import { NowPlayingStrip } from '@/features/tunarr/components/NowPlayingStrip'
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
  const { data: channelCollections } = useChannelCollections(selectedChannel?.number ?? 0)
  const buildCollections = useBuildChannelCollections()

  const setIcon = useAssignIconToChannel()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)
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
    // Name the Tunarr blast radius. The delete now cascades there, and a
    // confirmation that says only "this cannot be undone" would be hiding the
    // half of the consequence that lives in another system.
    const confirmed = await confirmDialog({
      title: `Delete channel ${ch.number} – ${ch.name}?`,
      text: tunarrLink
        ? `This also deletes Tunarr channel #${tunarrLink.tunarr_number ?? '?'} and its programming. Assignments, blocks and collection links go with it. This cannot be undone.`
        : 'Assignments, blocks and collection links go with it. This cannot be undone.',
      danger: true,
    })
    if (!confirmed) return
    deleteChannel.mutate(ch.number, {
      onSuccess: () => selectChannel(null),
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header.
          Mobile stacks it into three rows — identity + actions, then the tab
          strip full width, then now-playing — using `order` so the DOM keeps a
          sensible reading order while the desktop row stays identity ·
          now-playing · tabs · actions. Wrapping alone was not enough: on a
          375px screen all four groups landed in one wrapping row and the tabs
          ended up orphaned mid-line. */}
      <div className="shrink-0 border-b border-slate-800 bg-slate-900 px-3 py-2 sm:px-4 md:px-6 md:py-2.5">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {/* Identity */}
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
            {ch.icon ? (
              <div className="relative shrink-0">
                <img
                  src={ch.icon}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border border-slate-700"
                />
                <span
                  className={`absolute -bottom-1 -right-1 text-[9px] font-mono font-bold rounded-sm px-1 leading-tight shadow-sm ${tierNumberColor(ch.tier)}`}
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
              <h2 className="truncate text-sm font-semibold text-slate-100 md:text-base">
                {ch.name}
              </h2>
              {/* Badges scroll sideways rather than wrapping: on a phone they
                  wrapped to a second and third line and pushed the whole header
                  down before you could read anything. */}
              <div className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 md:mt-0 md:flex-wrap md:gap-2 md:overflow-visible [&::-webkit-scrollbar]:hidden">
                <TierBadge tier={ch.tier} />
                <span
                  className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-xs font-medium ${tierColor(ch.tier)}`}
                >
                  {assignments.length} assigned
                </span>
                {tunarrLink && (
                  <span className="shrink-0 rounded-sm border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300">
                    Tunarr #{tunarrLink.tunarr_number ?? '?'}
                  </span>
                )}
                {ch.vibe && (
                  <span className="hidden truncate text-xs text-slate-500 italic lg:inline">
                    {ch.vibe}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Now playing — renders nothing when the channel isn't linked or the
              EPG has no entry covering now. Last on mobile: it is the most
              informative thing here but also the tallest, so it goes below the
              controls rather than pushing them off-screen. */}
          <div className="order-4 w-full min-w-0 md:order-2 md:max-w-md md:flex-1">
            <NowPlayingStrip
              channelNumber={ch.number}
              linked={Boolean(tunarrLink)}
              onOpenGuide={() => openModal('channelGuide', { channelGuideChannel: ch.number })}
              onWatch={() => openModal('channelStream', { channelStreamChannel: ch.number })}
            />
          </div>

          {/* Tab strip — full-width equal thirds on mobile, so each is a
              comfortable tap target instead of three small pills. */}
          <div className="order-3 grid w-full grid-cols-3 gap-1 rounded-lg bg-slate-950/40 p-0.5 md:order-3 md:ml-auto md:flex md:w-auto md:bg-transparent md:p-0">
            {TABS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setActiveChannelTab(value)}
                aria-current={activeChannelTab === value ? 'page' : undefined}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors md:py-1.5 ${
                  activeChannelTab === value
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Actions overflow menu — ml-auto keeps it (and the right-anchored
              dropdown) at the pane's right edge when the header wraps, so the
              menu isn't clipped by the content pane's overflow-hidden */}
          <div className="relative order-2 shrink-0 md:order-4 md:ml-auto" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 md:p-1.5"
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
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2"
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
                    openModal('iconGenerator')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
                >
                  <svg
                    className="h-3.5 w-3.5 text-fuchsia-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Generate Icon
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    iconFileRef.current?.click()
                  }}
                  disabled={setIcon.isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  <svg
                    className="h-3.5 w-3.5 text-teal-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  Upload Icon
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('watermarkEditor')
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5 text-sky-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
                    <rect x="14" y="12" width="5.5" height="5" rx="1" />
                  </svg>
                  Watermark
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void buildCollections.build(ch.number, {
                      movie: channelCollections?.movie,
                      show: channelCollections?.show,
                    })
                  }}
                  disabled={buildCollections.isPending}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2 disabled:opacity-50"
                >
                  <svg
                    className="w-3.5 h-3.5 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M4 7h16M4 12h16M4 17h10" />
                    <circle cx="18" cy="17" r="3.2" />
                    <path d="M18 15.6v2.8M16.6 17h2.8" />
                  </svg>
                  {channelCollections?.movie || channelCollections?.show
                    ? 'Update Collections'
                    : 'Build Collections'}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('channelGuide', { channelGuideChannel: ch.number })
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5 text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 3v18" />
                  </svg>
                  Program Guide
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('channelStream', { channelStreamChannel: ch.number })
                  }}
                  disabled={!tunarrLink}
                  title={tunarrLink ? undefined : 'Link this channel to Tunarr first'}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <svg
                    className="w-3.5 h-3.5 text-rose-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M10 8.5l6 3.5-6 3.5z" />
                  </svg>
                  Watch Channel
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openModal('channelForm', { editingChannel: ch })
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700 md:py-2 flex items-center gap-2"
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
                  className="w-full text-left px-3 py-2.5 text-xs text-red-400 hover:bg-slate-700 md:py-2 flex items-center gap-2 disabled:opacity-50"
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

      {/* Upload target for the menu item above. Kept outside the dropdown so
          closing the menu on click does not unmount the input mid-dialog. */}
      <input
        ref={iconFileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const reader = new FileReader()
          reader.onload = () =>
            setIcon.mutate({ channelNumber: ch.number, iconData: reader.result as string })
          reader.readAsDataURL(file)
        }}
      />

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeChannelTab === 'content' && <ContentTab channelNumber={ch.number} />}
        {activeChannelTab === 'blocks' && <BlocksTab channelNumber={ch.number} />}
        {activeChannelTab === 'tunarr' && <TunarrTab channelNumber={ch.number} />}
      </div>
    </div>
  )
}
