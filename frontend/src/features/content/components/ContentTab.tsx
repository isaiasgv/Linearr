import { useState, type ReactNode } from 'react'
import { useChannelAssignments } from '@/features/assignments/hooks'
import {
  useChannelCollections,
  useCollectionStatus,
  useGenerateCollections,
  useUnlinkCollection,
} from '@/features/collections/hooks'
import { useTunarrCollectionLinks } from '@/features/tunarr/hooks'
import { PlexBrowser } from '@/features/plex/components/PlexBrowser'
import { AssignmentGrid } from '@/features/assignments/components/AssignmentGrid'
import { Spinner } from '@/shared/components/ui/Spinner'
import type { CollectionStatusEntry } from '@/shared/types'

type ContentSubTab = 'browse' | 'assigned'

interface ContentTabProps {
  channelNumber: number
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-400' : 'bg-slate-600'}`}
    />
  )
}

/** One per-type (movie/show) collection status line: Plex existence + Tunarr linkage + link/unlink. */
function CollectionTypeStatus({
  plexType,
  label,
  icon,
  status,
  linkedTitle,
  tunarrLinked,
  onLink,
  onUnlink,
}: {
  plexType: 'movie' | 'show'
  label: string
  icon: ReactNode
  status?: CollectionStatusEntry
  linkedTitle?: string
  tunarrLinked: boolean
  onLink: () => void
  onUnlink: () => void
}) {
  const plexExists = Boolean(status?.exists)
  const plexCount = status?.plex_count ?? 0

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1 text-slate-300 font-medium">
        {icon}
        {label}
      </span>

      {/* Plex existence */}
      <span
        className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded px-1.5 py-0.5"
        title={
          plexExists
            ? `Collection exists on Plex (${plexCount} item${plexCount !== 1 ? 's' : ''})`
            : 'No Plex collection yet'
        }
      >
        <img src="/plex.svg" alt="Plex" className="w-3 h-3 rounded-sm" />
        <StatusDot ok={plexExists} />
        <span className={plexExists ? 'text-slate-300' : 'text-slate-500'}>
          {plexExists ? plexCount : 'none'}
        </span>
      </span>

      {/* Tunarr linkage */}
      <span
        className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded px-1.5 py-0.5"
        title={tunarrLinked ? 'Collection synced to Tunarr' : 'Not on Tunarr'}
      >
        <img src="/tunarr.svg" alt="Tunarr" className="w-3 h-3 rounded-sm" />
        <StatusDot ok={tunarrLinked} />
        <span className={tunarrLinked ? 'text-slate-300' : 'text-slate-500'}>
          {tunarrLinked ? 'synced' : '—'}
        </span>
      </span>

      {/* Link / unlink */}
      {linkedTitle ? (
        <button
          onClick={onUnlink}
          title={`Unlink ${linkedTitle}`}
          className="flex items-center gap-1 text-slate-500 hover:text-red-400 transition-colors"
        >
          <span className="truncate max-w-28 text-slate-400">{linkedTitle}</span>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onLink}
          className={`flex items-center gap-1 border border-dashed rounded px-1.5 py-0.5 transition-colors ${
            plexType === 'movie'
              ? 'border-slate-600 hover:border-purple-600 text-slate-500 hover:text-purple-400'
              : 'border-slate-600 hover:border-blue-600 text-slate-500 hover:text-blue-400'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add from collection
        </button>
      )}
    </div>
  )
}

export function ContentTab({ channelNumber }: ContentTabProps) {
  const [subTab, setSubTab] = useState<ContentSubTab>('assigned')
  const [barOpen, setBarOpen] = useState(true)

  const { data: assignments = [] } = useChannelAssignments(channelNumber)
  const { data: channelCollections } = useChannelCollections(channelNumber)
  const { data: collectionStatus } = useCollectionStatus(channelNumber)
  const { data: tunarrCollectionLinks = [] } = useTunarrCollectionLinks()
  const generateCollections = useGenerateCollections()
  const unlinkCollection = useUnlinkCollection()

  const movieCollection = channelCollections?.movie
  const showCollection = channelCollections?.show

  const movieTunarrLinked = tunarrCollectionLinks.some(
    (l) => l.channel_number === channelNumber && l.plex_type === 'movie',
  )
  const showTunarrLinked = tunarrCollectionLinks.some(
    (l) => l.channel_number === channelNumber && l.plex_type === 'show',
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Collection status bar — slim + collapsible */}
      <div className="flex-shrink-0 bg-slate-900/60 border-b border-slate-800">
        <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
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
                plexType="movie"
                label="Movies"
                icon={
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="2" y="7" width="20" height="15" rx="2" />
                    <circle cx="12" cy="14" r="2" />
                  </svg>
                }
                status={collectionStatus?.movie}
                linkedTitle={movieCollection?.collection_title}
                tunarrLinked={movieTunarrLinked}
                onLink={() => setSubTab('browse')}
                onUnlink={() => unlinkCollection.mutate({ channelNumber, plexType: 'movie' })}
              />

              <span className="text-slate-700">|</span>

              <CollectionTypeStatus
                plexType="show"
                label="Shows"
                icon={
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="2" y="3" width="20" height="18" rx="2" />
                    <path d="M8 10h8M8 14h5" />
                  </svg>
                }
                status={collectionStatus?.show}
                linkedTitle={showCollection?.collection_title}
                tunarrLinked={showTunarrLinked}
                onLink={() => setSubTab('browse')}
                onUnlink={() => unlinkCollection.mutate({ channelNumber, plexType: 'show' })}
              />

              <button
                onClick={() => generateCollections.mutate(channelNumber)}
                disabled={generateCollections.isPending}
                title="Builds Linearr's own “{Channel} Movies/TV” collections from the assigned items and syncs them to Plex + Tunarr. Your own collections are never modified."
                className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 bg-indigo-900/40 hover:bg-indigo-900/70 border border-indigo-700 text-indigo-300 hover:text-indigo-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {generateCollections.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
      <div className="flex-shrink-0 flex border-b border-slate-800 bg-slate-950/40">
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
