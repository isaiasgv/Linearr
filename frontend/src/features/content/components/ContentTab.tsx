import { useState } from 'react'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannelAssignments } from '@/features/assignments/hooks'
import {
  useChannelCollections,
  useGenerateCollections,
  useUnlinkCollection,
} from '@/features/collections/hooks'
import { PlexBrowser } from '@/features/plex/components/PlexBrowser'
import { AssignmentGrid } from '@/features/assignments/components/AssignmentGrid'
import { Spinner } from '@/shared/components/ui/Spinner'

type ContentSubTab = 'browse' | 'assigned'

interface ContentTabProps {
  channelNumber: number
}

export function ContentTab({ channelNumber }: ContentTabProps) {
  const [subTab, setSubTab] = useState<ContentSubTab>('assigned')
  const { openModal } = useUIStore()

  const { data: assignments = [] } = useChannelAssignments(channelNumber)
  const { data: channelCollections } = useChannelCollections(channelNumber)
  const generateCollections = useGenerateCollections()
  const unlinkCollection = useUnlinkCollection()

  const movieCollection = channelCollections?.movie
  const showCollection = channelCollections?.show

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Collection status bar */}
      <div className="flex-shrink-0 px-4 py-3 bg-slate-900/60 border-b border-slate-800 flex items-center gap-3 flex-wrap">
        {/* Movie collection */}
        {movieCollection ? (
          <div className="flex items-center gap-1.5 text-xs bg-purple-900/30 border border-purple-800 text-purple-300 rounded-lg px-2.5 py-1">
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
            <span className="truncate max-w-32">{movieCollection.collection_title}</span>
            <button
              onClick={() => unlinkCollection.mutate({ channelNumber, plexType: 'movie' })}
              className="ml-1 text-purple-400 hover:text-purple-200 transition-colors"
              title="Unlink movie collection"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => openModal('collectionPicker', { collectionPickerType: 'movie' })}
            className="flex items-center gap-1.5 text-xs border border-dashed border-slate-600 hover:border-purple-600 text-slate-500 hover:text-purple-400 rounded-lg px-2.5 py-1 transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Link Movie Collection
          </button>
        )}

        {/* Show collection */}
        {showCollection ? (
          <div className="flex items-center gap-1.5 text-xs bg-blue-900/30 border border-blue-800 text-blue-300 rounded-lg px-2.5 py-1">
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
            <span className="truncate max-w-32">{showCollection.collection_title}</span>
            <button
              onClick={() => unlinkCollection.mutate({ channelNumber, plexType: 'show' })}
              className="ml-1 text-blue-400 hover:text-blue-200 transition-colors"
              title="Unlink show collection"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => openModal('collectionPicker', { collectionPickerType: 'show' })}
            className="flex items-center gap-1.5 text-xs border border-dashed border-slate-600 hover:border-blue-600 text-slate-500 hover:text-blue-400 rounded-lg px-2.5 py-1 transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Link Show Collection
          </button>
        )}

        {/* Generate collections button */}
        <button
          onClick={() => generateCollections.mutate(channelNumber)}
          disabled={generateCollections.isPending}
          className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 bg-indigo-900/40 hover:bg-indigo-900/70 border border-indigo-700 text-indigo-300 hover:text-indigo-200 rounded-lg transition-colors disabled:opacity-50"
        >
          {generateCollections.isPending ? (
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
          Generate Collections
        </button>
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
