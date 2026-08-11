import { useState, useMemo, useRef, type ReactNode } from 'react'
import { useUIStore, type TierFilter } from '@/shared/store/ui.store'
import { useChannels, useReorderChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { usePlexSessions } from '@/features/plex/hooks'
import { tierColor } from '@/shared/components/ui/TierBadge'
import { ChannelSkeleton, confirmDialog } from '@/shared/components/ui'
import { channelKey, tierNumberColor } from '@/features/channels/utils'
import {
  channelDropTargetIndex,
  computeReorder,
  describeNamedReorderChanges,
  describeReorderChanges,
  hiddenReorderChanges,
} from '@/features/channels/reorder'
import type { Channel } from '@/shared/types'

const TIER_FILTERS: { label: string; value: TierFilter }[] = [
  { label: 'All', value: 'All' },
  { label: 'Main', value: 'Galaxy Main' },
  { label: 'Classics', value: 'Classics' },
  { label: 'Premium', value: 'Galaxy Premium' },
]

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

/** Six-dot grip — the drag affordance, matching the block HourGrid's handle. */
function DragGrip() {
  return (
    <svg className="w-3 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
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
    draggingChannelNumber,
    dragOverChannelNumber,
    setDraggingChannel,
    setDragOverChannel,
    clearChannelDrag,
  } = useUIStore()

  const { data: channels = [], isLoading: channelsLoading } = useChannels()
  const reorderChannels = useReorderChannels()
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

  // Reordering renumbers, and the drop index is resolved against the FULL
  // lineup — a search-narrowed list would let the user drop "between" two rows
  // that aren't actually adjacent, so drag is off while searching. A tier filter
  // still allows it: every visible row keeps its real lineup position, so the
  // index math holds. The renumber WINDOW is a different matter — it spans the
  // full lineup, hidden rows included, which is what `handleDrop` confirms.
  const canReorder = !collapsed && !search
  const dragEnabled = canReorder && !reorderChannels.isPending

  // ── Touch reordering ───────────────────────────────────────────────────────
  // HTML5 drag-and-drop does not exist on touch: `dragstart` never fires from a
  // finger, so the sidebar was simply not reorderable on a phone. This is a
  // hand-rolled pointer-event path — deliberately no drag library, per the
  // project's standing rule — that ends in the same `commitReorder`.
  //
  // Long-press to arm rather than drag-on-touch, because the row is also a tap
  // target: starting a drag immediately would make every tap feel unstable and
  // would fight the list's own scrolling.
  const LONG_PRESS_MS = 350
  const touchDrag = useRef<{ timer: number | null; number: number | null; armed: boolean }>({
    timer: null,
    number: null,
    armed: false,
  })

  function cancelTouchDrag() {
    if (touchDrag.current.timer !== null) window.clearTimeout(touchDrag.current.timer)
    touchDrag.current = { timer: null, number: null, armed: false }
  }

  function handleGripPointerDown(e: React.PointerEvent, ch: Channel) {
    if (e.pointerType === 'mouse' || !dragEnabled) return
    const grip = e.currentTarget as HTMLElement
    touchDrag.current.number = ch.number
    touchDrag.current.timer = window.setTimeout(() => {
      touchDrag.current.armed = true
      setDraggingChannel(ch.number)
      // Capture so the whole gesture keeps reporting to this element even once
      // the finger has moved far away from it.
      try {
        grip.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort */
      }
      // A short buzz is the only feedback that the row is now draggable —
      // without it a long-press is indistinguishable from a missed tap.
      navigator.vibrate?.(15)
    }, LONG_PRESS_MS)
  }

  function handleGripPointerMove(e: React.PointerEvent) {
    if (!touchDrag.current.armed) {
      // Moved before the press armed — that is a scroll, not a drag.
      if (touchDrag.current.timer !== null) cancelTouchDrag()
      return
    }
    e.preventDefault()
    // There is no `dragover` here, so the row under the finger has to be found
    // by hit-testing. `data-channel-number` on the row is what makes that work.
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const row = el?.closest<HTMLElement>('[data-channel-number]')
    const n = row ? Number(row.dataset.channelNumber) : NaN
    setDragOverChannel(Number.isFinite(n) ? n : null)
  }

  async function handleGripPointerUp(e: React.PointerEvent) {
    const { armed, number } = touchDrag.current
    cancelTouchDrag()
    if (!armed || number === null) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const row = el?.closest<HTMLElement>('[data-channel-number]')
    const targetNumber = row ? Number(row.dataset.channelNumber) : NaN
    clearChannelDrag()
    if (!Number.isFinite(targetNumber)) return
    const target = channels.find((c) => c.number === targetNumber)
    if (target) await commitReorder(number, target)
  }

  function handleDragStart(e: React.DragEvent, ch: Channel) {
    // Firefox refuses to start a drag unless dataTransfer carries something.
    e.dataTransfer.setData('text/plain', String(ch.number))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingChannel(ch.number)
  }

  function handleDragOver(e: React.DragEvent, ch: Channel) {
    if (draggingChannelNumber === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverChannel(ch.number)
  }

  async function handleDrop(e: React.DragEvent, target: Channel) {
    e.preventDefault()
    const movedNumber = draggingChannelNumber
    clearChannelDrag()
    await commitReorder(movedNumber, target)
  }

  /**
   * Apply a reorder, with the confirmations it warrants.
   *
   * Shared by the two input paths — HTML5 drag-and-drop on desktop and the
   * pointer-driven long-press on touch — so the confirmation rules cannot drift
   * between them. A renumber is the same consequence however it was triggered.
   */
  async function commitReorder(movedNumber: number | null, target: Channel) {
    if (movedNumber === null || movedNumber === target.number) return

    const moved = channels.find((c) => c.number === movedNumber)
    if (!moved) return

    // Post-drop index = the pre-drop index of the row we dropped on, in the
    // full lineup. See `channelDropTargetIndex` for why that holds both ways.
    const targetIndex = channelDropTargetIndex(channels, target.number)
    if (targetIndex < 0) return

    const crossTier = moved.tier !== target.tier
    const targetTier = crossTier ? target.tier : null
    // Preview EVERY drop, not just cross-tier ones: the renumber window spans
    // the full lineup, so an in-tier drag across a channel of another tier that
    // sits numerically between the endpoints renumbers that channel too — and
    // with a tier filter on, the user cannot see it happen.
    const preview = computeReorder(channels, movedNumber, targetIndex, targetTier)
    if (preview.length === 0) return

    const hidden = hiddenReorderChanges(preview, visibleChannels)

    // Confirm when the change is bigger than what the user can see happening:
    // a cross-tier drop (it changes the tier AND renumbers into that tier's
    // range), or any drop that renumbers a channel the current filter hides.
    // An in-tier nudge that only touches visible rows must not nag.
    if (crossTier || hidden.length > 0) {
      const hiddenNote = hidden.length
        ? ` Includes ${hidden.length} channel${hidden.length === 1 ? '' : 's'} hidden by the current filter: ${describeNamedReorderChanges(hidden, channels)}.`
        : ''
      const confirmed = await confirmDialog(
        crossTier
          ? {
              title: `Move ${moved.name} to ${target.tier}?`,
              text: `${preview.length} channel${preview.length === 1 ? '' : 's'} will be renumbered: ${describeReorderChanges(preview)}.${hiddenNote}`,
              confirmText: 'Move & renumber',
            }
          : {
              title: `Renumber ${hidden.length} hidden channel${hidden.length === 1 ? '' : 's'}?`,
              text: `Moving ${moved.name} renumbers every channel between its old and new position — including rows this filter is not showing.${hiddenNote}`,
              confirmText: 'Renumber',
            },
      )
      if (!confirmed) return
    }

    reorderChannels.mutate({
      moved_number: movedNumber,
      target_index: targetIndex,
      target_tier: targetTier,
    })
  }

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
          icon={<img src="/plex.svg" alt="Plex" className="w-4 h-4 rounded-xs" />}
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
          icon={<img src="/tunarr.svg" alt="Tunarr" className="w-4 h-4 rounded-xs" />}
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
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-slate-500 hover:text-slate-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
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
      <div
        className={`flex-1 overflow-y-auto py-1 ${collapsed ? 'px-1.5' : ''}`}
        aria-busy={reorderChannels.isPending || undefined}
      >
        {reorderChannels.isPending && !collapsed && (
          <p className="px-3 py-1 text-[10px] text-indigo-300">Renumbering channels…</p>
        )}
        {channelsLoading &&
          !collapsed &&
          Array.from({ length: 6 }, (_, i) => <ChannelSkeleton key={i} />)}
        {!channelsLoading && visibleChannels.length === 0 && !collapsed && (
          <p className="text-center text-xs text-slate-500 py-8">No channels</p>
        )}
        {visibleChannels.map((ch) => {
          const assignments = assignmentsMap[ch.number] ?? []
          const isLinked = tunarrLinks.some((l) => l.channel_number === ch.number)
          const isSelected = selectedChannel?.number === ch.number
          const isDragging = draggingChannelNumber === ch.number
          const isDragOver = dragOverChannelNumber === ch.number && !isDragging
          // Stable `uid` identity, with a safe fallback — see `channelKey`.
          const rowKey = channelKey(ch)

          if (collapsed) {
            return (
              <button
                key={rowKey}
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
            <div
              key={rowKey}
              // Hit-testing target for the touch path: `elementFromPoint` finds
              // the row under the finger and reads the number back off here.
              data-channel-number={ch.number}
              draggable={dragEnabled}
              onDragStart={(e) => handleDragStart(e, ch)}
              onDragEnd={clearChannelDrag}
              onDragOver={(e) => handleDragOver(e, ch)}
              onDrop={(e) => void handleDrop(e, ch)}
              className={`group flex items-center transition-colors ${
                isSelected
                  ? 'bg-slate-700 border-l-2 border-indigo-500'
                  : 'border-l-2 border-transparent hover:bg-slate-800'
              } ${isDragging ? 'opacity-40' : ''} ${
                isDragOver ? 'ring-1 ring-inset ring-indigo-400 bg-indigo-900/25' : ''
              } ${dragEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {canReorder && (
                <span
                  title="Drag to reorder (renumbers the channel). On touch, press and hold."
                  aria-label={`Reorder ${ch.name}. Press and hold, then drag.`}
                  onPointerDown={(e) => handleGripPointerDown(e, ch)}
                  onPointerMove={handleGripPointerMove}
                  onPointerUp={(e) => void handleGripPointerUp(e)}
                  onPointerCancel={cancelTouchDrag}
                  // `touch-action: none` ONLY on the grip. Putting it on the row
                  // would kill scrolling of the channel list; here it just stops
                  // the browser claiming the gesture as a scroll once a finger
                  // is on the handle.
                  style={{ touchAction: 'none' }}
                  className="-mr-1 shrink-0 py-2 pr-1 pl-2 text-slate-700 group-hover:text-slate-500 md:py-0 md:pr-0 md:pl-1"
                >
                  <DragGrip />
                </span>
              )}
              <button
                onClick={() => selectChannel(ch)}
                className={`flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left ${
                  canReorder ? 'pl-2 pr-3' : 'px-3'
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
                      className={`absolute -bottom-1 -right-1 text-[9px] font-mono font-bold rounded-sm px-1 leading-tight shadow-sm ${tierNumberColor(ch.tier)}`}
                    >
                      {ch.number}
                    </span>
                  </div>
                ) : (
                  <span
                    className={`shrink-0 w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${tierNumberColor(ch.tier)}`}
                  >
                    {ch.number}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-100 truncate">{ch.name}</span>
                    {isLinked && (
                      <span
                        className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400"
                        title="Linked to Tunarr"
                      />
                    )}
                  </div>
                  {ch.vibe && <p className="text-xs text-slate-500 truncate">{ch.vibe}</p>}
                </div>

                {assignments.length > 0 && (
                  <span
                    className={`shrink-0 text-xs rounded-full px-1.5 py-0.5 font-medium border ${tierColor(ch.tier)}`}
                  >
                    {assignments.length}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
