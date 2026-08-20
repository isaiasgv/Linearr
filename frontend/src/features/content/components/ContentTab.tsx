import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useChannelAssignments, usePurgeChannel } from '@/features/assignments/hooks'
import {
  useChannelCollections,
  useCollectionStatus,
  useDeletePlexCollection,
  useBuildChannelCollections,
  useUnlinkCollection,
} from '@/features/collections/hooks'
import { useSyncCollections, useTunarrCollectionLinks } from '@/features/tunarr/hooks'
import { PlexBrowser } from '@/features/plex/components/PlexBrowser'
import { AssignmentGrid } from '@/features/assignments/components/AssignmentGrid'
import { Spinner } from '@/shared/components/ui/Spinner'
import { StatusDot, confirmDialog } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import type { ChannelCollection, CollectionStatusEntry } from '@/shared/types'

type ContentSubTab = 'browse' | 'assigned'

interface ContentTabProps {
  channelNumber: number
}

/** Small pill used for the owned/assigned/smart source badges. */
function Badge({
  tone,
  title,
  children,
}: {
  tone: 'owned' | 'assigned' | 'smart'
  title: string
  children: ReactNode
}) {
  const TONES: Record<typeof tone, string> = {
    owned: 'bg-indigo-900/40 border-indigo-700/60 text-indigo-300',
    assigned: 'bg-amber-900/30 border-amber-700/60 text-amber-300',
    smart: 'bg-cyan-900/40 border-cyan-700/60 text-cyan-300',
  }
  return (
    <span
      title={title}
      className={`shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** Dropdown of the slot actions that don't fit inline. */
function SlotMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="relative" ref={ref} onClick={() => setOpen(false)}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center px-1 py-0.5 text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-20 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  disabled,
  danger,
  description,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  description?: string
  children: ReactNode
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed focus:outline-hidden ${
        danger
          ? 'text-red-400 hover:bg-red-950/50 focus-visible:bg-red-950/50'
          : 'text-slate-300 hover:bg-slate-700 focus-visible:bg-slate-700'
      }`}
    >
      {children}
      {description && (
        <span className="block text-[10px] text-slate-500 mt-0.5">{description}</span>
      )}
    </button>
  )
}

/**
 * One per-type (movie/show) collection slot.
 *
 * A channel has exactly ONE active source per type, and which kind it is
 * decides what you can do with it:
 *   owned    — `{Channel} Movies` / `{Channel} TV`, generated and maintained by
 *              Linearr from the channel's assignments.
 *   assigned — a pre-existing Plex collection, referenced only. Linearr never
 *              edits its contents; "Build collections" switches the slot back
 *              to owned (the assigned collection is left untouched in Plex).
 */
function CollectionTypeStatus({
  label,
  icon,
  status,
  collection,
  tunarrLinked,
  onAssign,
  onNewSmart,
  onEditFilters,
  onDeleteCollection,
  onImportItems,
  onUnassign,
  onPushToTunarr,
  onBuildToPlex,
  pushPending,
  buildPending,
  busy,
}: {
  label: string
  icon: ReactNode
  status?: CollectionStatusEntry
  collection?: ChannelCollection
  tunarrLinked: boolean
  onAssign: () => void
  onNewSmart: () => void
  onEditFilters: () => void
  onDeleteCollection: () => void
  onImportItems: () => void
  onUnassign: () => void
  onPushToTunarr: () => void
  onBuildToPlex: () => void
  pushPending: boolean
  buildPending: boolean
  busy: boolean
}) {
  const plexExists = Boolean(status?.exists)
  const plexCount = status?.plex_count ?? 0

  const isAssigned = collection?.source === 'assigned'
  const isSmart = isAssigned && Boolean(collection?.is_smart)
  // Rule editing and deletion are only offered for a smart collection LINEARR
  // created. Plex cannot read a smart collection's rules back, so the builder
  // opens blank — "Replace filters" on a user's own collection would swap their
  // rules for an empty filter set that matches the whole library, with no undo.
  const isOwnSmart = isSmart && Boolean(collection?.linearr_created)
  // Owned slots may not exist in Plex yet — the generator names them, so the
  // status endpoint still knows the name to show.
  const title = isAssigned ? collection!.collection_title : (status?.name ?? '—')

  return (
    // Wraps within itself: this row is ~380px of chips, which is wider than a
    // phone, and letting it overflow pushed the actions menu off-screen.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="flex items-center gap-1 font-medium text-slate-300">
        {icon}
        {label}
      </span>

      {/* Active source: kind + title */}
      <span className="flex items-center gap-1.5 min-w-0">
        {isAssigned ? (
          <Badge
            tone="assigned"
            title="A pre-existing Plex collection this channel references. Linearr never changes its contents."
          >
            assigned
          </Badge>
        ) : (
          <Badge
            tone="owned"
            title="Linearr generates and maintains this collection from the channel's assigned items."
          >
            owned
          </Badge>
        )}
        {isSmart && (
          <Badge tone="smart" title="Rule-based collection — Plex keeps it current automatically">
            smart
          </Badge>
        )}
        <span className="truncate max-w-44 text-slate-300" title={title}>
          {title}
        </span>
        {!isAssigned && <span className="text-slate-600">(generated)</span>}
      </span>

      {/* Plex existence — the counterpart of the Tunarr chip beside it, and a
          button for the same reason: the two are styled identically, so a
          static one reads as a dead button. Building is the Plex-side push. */}
      <button
        onClick={onBuildToPlex}
        disabled={buildPending}
        title={
          plexExists
            ? `Collection exists on Plex (${plexCount} item${plexCount !== 1 ? 's' : ''}) — click to rebuild it from this channel's assignments`
            : 'No Plex collection yet — click to build it from this channel’s assignments'
        }
        className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 hover:border-slate-500 rounded-sm px-1.5 py-0.5 transition-colors disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <img src="/plex.svg" alt="Plex" className="w-3 h-3 rounded-xs" />
        {buildPending ? (
          <Spinner size="sm" />
        ) : (
          <StatusDot state={plexExists ? 'ok' : 'unknown'} pulse={false} />
        )}
        <span className={plexExists ? 'text-slate-300' : 'text-slate-500'}>
          {plexExists ? plexCount : 'build'}
        </span>
      </button>

      {/* Tunarr linkage */}
      <button
        onClick={onPushToTunarr}
        disabled={pushPending}
        title={
          tunarrLinked
            ? 'Synced to Tunarr — click to push again'
            : 'Push this channel’s collections to Tunarr'
        }
        className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 hover:border-slate-500 rounded-sm px-1.5 py-0.5 transition-colors disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <img src="/tunarr.svg" alt="Tunarr" className="w-3 h-3 rounded-xs" />
        {pushPending ? (
          <Spinner size="sm" />
        ) : (
          <StatusDot state={tunarrLinked ? 'ok' : 'unknown'} pulse={false} />
        )}
        <span className={tunarrLinked ? 'text-slate-300' : 'text-slate-500'}>
          {tunarrLinked ? 'synced' : 'push'}
        </span>
      </button>

      {/* Actions */}
      <SlotMenu label={`${label} collection actions`}>
        <MenuItem onClick={onAssign} disabled={busy} description="Reference it — never modified">
          Assign existing collection…
        </MenuItem>
        <MenuItem onClick={onNewSmart} disabled={busy} description="Created in Plex, then assigned">
          New smart collection…
        </MenuItem>
        {isOwnSmart && (
          <>
            <div className="my-1 border-t border-slate-700" />
            <MenuItem
              onClick={onEditFilters}
              disabled={busy}
              description="Replaces this collection's rules"
            >
              Edit filters…
            </MenuItem>
            <MenuItem
              onClick={onDeleteCollection}
              disabled={busy}
              danger
              description="Removes it from Plex for good"
            >
              Delete collection from Plex…
            </MenuItem>
          </>
        )}
        <div className="my-1 border-t border-slate-700" />
        <MenuItem
          onClick={onImportItems}
          disabled={busy}
          description="Copies a collection's items into assignments"
        >
          Import items from a collection…
        </MenuItem>
        {isAssigned && (
          <MenuItem
            onClick={onUnassign}
            disabled={busy}
            danger
            description="Drops the link only — Plex is untouched"
          >
            Unassign
          </MenuItem>
        )}
      </SlotMenu>
    </div>
  )
}

function PurgeMenu({
  channelNumber,
  movieCount,
  showCount,
}: {
  channelNumber: number
  movieCount: number
  showCount: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const purge = usePurgeChannel()
  const total = movieCount + showCount

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  async function handlePurge(
    contentType: 'movies' | 'shows' | 'both',
    count: number,
    label: string,
  ) {
    setOpen(false)
    if (count === 0) return
    const confirmed = await confirmDialog({
      title: `Remove ${label}?`,
      text: `This removes ${count} ${label} from this channel's assignments. Your Plex library is not affected.`,
      confirmText: 'Remove',
      danger: true,
    })
    if (confirmed) purge.mutate({ channelNumber, contentType })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={total === 0 || purge.isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Remove assigned content in bulk"
        className="flex items-center gap-1 text-xs px-2.5 py-1 text-slate-400 hover:text-red-300 border border-slate-700 hover:border-red-800 rounded-lg transition-colors disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:border-slate-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {purge.isPending ? (
          <Spinner size="sm" />
        ) : (
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
          </svg>
        )}
        Purge
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1"
        >
          <button
            role="menuitem"
            onClick={() => handlePurge('movies', movieCount, 'movies')}
            disabled={movieCount === 0}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 focus:outline-hidden focus-visible:bg-slate-700"
          >
            Remove all movies ({movieCount})
          </button>
          <button
            role="menuitem"
            onClick={() => handlePurge('shows', showCount, 'shows')}
            disabled={showCount === 0}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 focus:outline-hidden focus-visible:bg-slate-700"
          >
            Remove all shows ({showCount})
          </button>
          <div className="my-1 border-t border-slate-700" />
          <button
            role="menuitem"
            onClick={() => handlePurge('both', total, 'assigned content')}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus:outline-hidden focus-visible:bg-red-950/50"
          >
            Remove everything ({total})
          </button>
        </div>
      )}
    </div>
  )
}

export function ContentTab({ channelNumber }: ContentTabProps) {
  const [subTab, setSubTab] = useState<ContentSubTab>('assigned')
  // Collapsed by default on a phone. Expanded it is three stacked rows of
  // chips, which pushed the actual content — the posters people came for —
  // most of the way off a 375px screen before anything loaded.
  const [barOpen, setBarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768,
  )

  const { data: assignments = [] } = useChannelAssignments(channelNumber)
  const { data: channelCollections } = useChannelCollections(channelNumber)
  const { data: collectionStatus } = useCollectionStatus(channelNumber)
  const { data: tunarrCollectionLinks = [] } = useTunarrCollectionLinks()
  const buildCollections = useBuildChannelCollections()
  const unlinkCollection = useUnlinkCollection()
  const deletePlexCollection = useDeletePlexCollection()
  const syncCollections = useSyncCollections()
  const openModal = useUIStore((s) => s.openModal)

  const movieCollection = channelCollections?.movie
  const showCollection = channelCollections?.show

  const movieTunarrLinked = tunarrCollectionLinks.some(
    (l) => l.channel_number === channelNumber && l.plex_type === 'movie',
  )
  const showTunarrLinked = tunarrCollectionLinks.some(
    (l) => l.channel_number === channelNumber && l.plex_type === 'show',
  )

  const busy =
    buildCollections.isPending || unlinkCollection.isPending || deletePlexCollection.isPending

  function openAssign(plexType: 'movie' | 'show') {
    openModal('assignCollection', {
      collectionSlotChannel: channelNumber,
      collectionSlotType: plexType,
    })
  }

  function openSmartBuilder(plexType: 'movie' | 'show', collection?: ChannelCollection) {
    openModal('smartCollectionBuilder', {
      collectionSlotChannel: channelNumber,
      collectionSlotType: plexType,
      smartBuilderEdit: collection
        ? { ratingKey: collection.collection_rating_key, title: collection.collection_title }
        : null,
    })
  }

  /**
   * Defence in depth for the two destructive smart-collection actions. The menu
   * already hides both unless Linearr created the collection (see
   * `isOwnSmart`); these guards make a stray call a no-op rather than a
   * rules-wipe or a permanent delete of a collection that isn't ours.
   */
  function handleEditFilters(plexType: 'movie' | 'show', collection?: ChannelCollection) {
    if (!collection?.linearr_created) return
    openSmartBuilder(plexType, collection)
  }

  async function handleUnassign(plexType: 'movie' | 'show', collection: ChannelCollection) {
    const confirmed = await confirmDialog({
      title: `Unassign “${collection.collection_title}”?`,
      text: `This channel stops using it as its ${plexType === 'movie' ? 'movie' : 'show'} collection. The collection itself stays in Plex, unchanged.`,
      confirmText: 'Unassign',
    })
    if (confirmed) unlinkCollection.mutate({ channelNumber, plexType })
  }

  async function handleDeleteCollection(collection: ChannelCollection) {
    if (!collection.linearr_created) return
    const confirmed = await confirmDialog({
      title: `Delete “${collection.collection_title}” from Plex?`,
      text: 'This permanently deletes the collection on your Plex server and unassigns it from every channel that references it. The media itself is not deleted.',
      confirmText: 'Delete from Plex',
      danger: true,
    })
    if (confirmed)
      deletePlexCollection.mutate({
        ratingKey: collection.collection_rating_key,
        channelNumber,
        title: collection.collection_title,
      })
  }

  async function handleBuild() {
    // Shared with the channel actions menu (ChannelDetail) so both entry points
    // warn about the assigned -> owned switch identically.
    await buildCollections.build(channelNumber, {
      movie: movieCollection,
      show: showCollection,
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Collection status bar — slim + collapsible */}
      <div className="shrink-0 bg-slate-900/60 border-b border-slate-800">
        {/* Column on mobile so each collection slot gets its own line; the
            desktop single wrapping row is unchanged from md up. */}
        <div className="flex flex-col items-stretch gap-2 px-3 py-1.5 md:flex-row md:flex-wrap md:items-center">
          <button
            onClick={() => setBarOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            title={barOpen ? 'Hide collections' : 'Show collections'}
          >
            <svg
              className={`w-3 h-3 transition-transform ${barOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            Collections
          </button>

          {barOpen && (
            <>
              <CollectionTypeStatus
                label="Movies"
                icon={
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="2" y="7" width="20" height="15" rx="2" />
                    <circle cx="12" cy="14" r="2" />
                  </svg>
                }
                status={collectionStatus?.movie}
                collection={movieCollection}
                tunarrLinked={movieTunarrLinked}
                busy={busy}
                pushPending={syncCollections.isPending}
                onAssign={() => openAssign('movie')}
                onNewSmart={() => openSmartBuilder('movie')}
                onEditFilters={() => handleEditFilters('movie', movieCollection)}
                onDeleteCollection={() =>
                  movieCollection && void handleDeleteCollection(movieCollection)
                }
                onImportItems={() => setSubTab('browse')}
                onUnassign={() => movieCollection && void handleUnassign('movie', movieCollection)}
                onPushToTunarr={() => syncCollections.mutate(channelNumber)}
                onBuildToPlex={() => void handleBuild()}
                buildPending={buildCollections.isPending}
              />

              {/* Separator only makes sense when the two slots share a line. */}
              <span className="hidden text-slate-700 md:inline">|</span>
              <span className="h-px bg-slate-800 md:hidden" />

              <CollectionTypeStatus
                label="Shows"
                icon={
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="2" y="3" width="20" height="18" rx="2" />
                    <path d="M8 10h8M8 14h5" />
                  </svg>
                }
                status={collectionStatus?.show}
                collection={showCollection}
                tunarrLinked={showTunarrLinked}
                busy={busy}
                pushPending={syncCollections.isPending}
                onAssign={() => openAssign('show')}
                onNewSmart={() => openSmartBuilder('show')}
                onEditFilters={() => handleEditFilters('show', showCollection)}
                onDeleteCollection={() =>
                  showCollection && void handleDeleteCollection(showCollection)
                }
                onImportItems={() => setSubTab('browse')}
                onUnassign={() => showCollection && void handleUnassign('show', showCollection)}
                onPushToTunarr={() => syncCollections.mutate(channelNumber)}
                onBuildToPlex={() => void handleBuild()}
                buildPending={buildCollections.isPending}
              />

              <button
                onClick={() => void handleBuild()}
                disabled={buildCollections.isPending}
                title="Rebuilds Linearr's own “{Channel} Movies/TV” collections from this channel's assigned items — adding what's new and removing what you've taken off the channel. A slot that references one of your own collections is left alone; unassign it first if you want Linearr to generate that type instead."
                className="flex items-center justify-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-900/40 px-2.5 py-2 text-xs text-indigo-300 transition-colors hover:bg-indigo-900/70 hover:text-indigo-200 disabled:opacity-50 md:ml-auto md:py-1"
              >
                {buildCollections.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Build collections
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sub-tab strip */}
      <div className="shrink-0 flex border-b border-slate-800 bg-slate-950/40">
        <button
          onClick={() => setSubTab('browse')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            subTab === 'browse'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Browse Plex
        </button>
        <button
          onClick={() => setSubTab('assigned')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            subTab === 'assigned'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Assigned
          <span className="ml-1.5 text-xs bg-slate-700 text-slate-300 rounded-full px-1.5 py-0.5">
            {assignments.length}
          </span>
        </button>

        {subTab === 'assigned' && assignments.length > 0 && (
          <div className="ml-auto flex items-center pr-3">
            <PurgeMenu
              channelNumber={channelNumber}
              movieCount={assignments.filter((a) => a.plex_type === 'movie').length}
              showCount={assignments.filter((a) => a.plex_type === 'show').length}
            />
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {subTab === 'browse' ? (
          <PlexBrowser channelNumber={channelNumber} />
        ) : (
          <AssignmentGrid channelNumber={channelNumber} />
        )}
      </div>
    </div>
  )
}
