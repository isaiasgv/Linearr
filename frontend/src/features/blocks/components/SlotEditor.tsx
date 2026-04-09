import { useState } from 'react'
import { useBlockStore } from '@/features/blocks/store'
import { useAddSlot, useBlockSuggestions } from '@/features/blocks/hooks'
import { usePlexSearch } from '@/features/plex/hooks'
import { useDebounce } from '@/shared/hooks/useDebounce'
import type { Assignment, PlexItem } from '@/shared/types'
import { Spinner } from '@/shared/components/ui/Spinner'

interface SlotEditorProps {
  blockId: number
  targetHour: string
}

const DURATION_OPTIONS = [
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
  { label: '3h', value: 180 },
]

function ItemThumb({ thumb, title }: { thumb: string | null; title: string }) {
  if (!thumb) {
    return (
      <div className="w-7 h-10 flex-shrink-0 bg-slate-700 rounded flex items-center justify-center">
        <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={`/api/plex/thumb?path=${encodeURIComponent(thumb)}`}
      alt={title}
      loading="lazy"
      className="w-7 h-10 flex-shrink-0 object-cover rounded"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}

export function SlotEditor({ blockId, targetHour }: SlotEditorProps) {
  const { slotSearch, setSlotSearch, cancelAddingSlot } = useBlockStore()
  const [duration, setDuration] = useState(60)

  const debouncedQuery = useDebounce(slotSearch, 400)

  const { data: searchResults = [], isLoading: searchLoading } = usePlexSearch(
    debouncedQuery,
    undefined,
    !!debouncedQuery,
  )

  const { data: suggestions = [], isLoading: suggestionsLoading } = useBlockSuggestions(
    blockId,
    !debouncedQuery,
  )

  const addSlot = useAddSlot()

  function handleSelect(item: PlexItem) {
    addSlot.mutate(
      {
        blockId,
        data: {
          slot_time: targetHour,
          plex_rating_key: item.rating_key,
          plex_title: item.title,
          plex_type: item.type,
          plex_thumb: item.thumb,
          plex_year: item.year,
          duration_minutes: duration,
        },
      },
      { onSuccess: () => cancelAddingSlot() },
    )
  }

  function handleSelectSuggestion(item: Assignment) {
    addSlot.mutate(
      {
        blockId,
        data: {
          slot_time: targetHour,
          plex_rating_key: item.plex_rating_key,
          plex_title: item.plex_title,
          plex_type: item.plex_type,
          plex_thumb: item.plex_thumb,
          plex_year: item.plex_year,
          duration_minutes: duration,
        },
      },
      { onSuccess: () => cancelAddingSlot() },
    )
  }

  const isLoading = debouncedQuery ? searchLoading : suggestionsLoading
  const items = debouncedQuery ? searchResults : []
  const displaySuggestions = !debouncedQuery ? suggestions : []

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">Add slot at {targetHour}</span>
        <button
          onClick={cancelAddingSlot}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Duration picker */}
      <div className="px-3 pt-2 flex items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-1">Duration:</span>
        {DURATION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDuration(opt.value)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              duration === opt.value
                ? 'bg-indigo-700 text-indigo-100'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="px-3 py-2">
        <input
          type="text"
          value={slotSearch}
          onChange={(e) => setSlotSearch(e.target.value)}
          placeholder="Search Plex..."
          autoFocus
          className="w-full bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      {/* Results list */}
      <div className="max-h-56 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" />
          </div>
        )}

        {!isLoading && debouncedQuery && items.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">
            No results for "{debouncedQuery}"
          </p>
        )}

        {/* Search results */}
        {items.map((item) => (
          <button
            key={item.rating_key}
            onClick={() => handleSelect(item)}
            disabled={addSlot.isPending}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-700 transition-colors text-left disabled:opacity-50"
          >
            <ItemThumb thumb={item.thumb} title={item.title} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-100 truncate">{item.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {item.year && <span className="text-xs text-slate-500">{item.year}</span>}
                <span
                  className={`text-xs px-1 py-0.5 rounded ${
                    item.type === 'show'
                      ? 'bg-blue-900/50 text-blue-400'
                      : 'bg-purple-900/50 text-purple-400'
                  }`}
                >
                  {item.type === 'show' ? 'TV' : 'Movie'}
                </span>
              </div>
            </div>
            {addSlot.isPending && <Spinner size="sm" />}
          </button>
        ))}

        {/* Suggestions (unscheduled assignments) */}
        {!debouncedQuery && displaySuggestions.length > 0 && (
          <>
            <div className="px-3 py-1 border-t border-slate-800">
              <span className="text-xs text-slate-500 font-medium">Suggested</span>
            </div>
            {displaySuggestions.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectSuggestion(item)}
                disabled={addSlot.isPending}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-700 transition-colors text-left disabled:opacity-50"
              >
                <ItemThumb thumb={item.plex_thumb} title={item.plex_title} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-100 truncate">{item.plex_title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {item.plex_year && (
                      <span className="text-xs text-slate-500">{item.plex_year}</span>
                    )}
                    <span
                      className={`text-xs px-1 py-0.5 rounded ${
                        item.plex_type === 'show'
                          ? 'bg-blue-900/50 text-blue-400'
                          : 'bg-purple-900/50 text-purple-400'
                      }`}
                    >
                      {item.plex_type === 'show' ? 'TV' : 'Movie'}
                    </span>
                  </div>
                </div>
                {addSlot.isPending && <Spinner size="sm" />}
              </button>
            ))}
          </>
        )}

        {!isLoading && !debouncedQuery && displaySuggestions.length === 0 && (
          <p className="text-xs text-slate-600 text-center py-4">Search Plex to add content</p>
        )}
      </div>
    </div>
  )
}
