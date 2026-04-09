import { useState, useMemo } from 'react'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useUIStore } from '@/shared/store/ui.store'
import { useAssignments, useAssign, useUnassign } from '@/features/assignments/hooks'
import {
  usePlexLibraries,
  usePlexLibraryItems,
  usePlexSearch,
} from '@/features/plex/hooks'
import { PosterGrid } from './PosterGrid'
import type { PlexItem } from '@/shared/types'

type TypeFilter = 'all' | 'show' | 'movie'

interface PlexBrowserProps {
  channelNumber: number
}

export function PlexBrowser({ channelNumber }: PlexBrowserProps) {
  const openModal = useUIStore((s) => s.openModal)

  const [selectedLibrary, setSelectedLibrary] = useState<string>('')
  const [loadLibrary, setLoadLibrary] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const debouncedSearch = useDebounce(searchInput, 400)
  const isSearching = debouncedSearch.trim().length > 0

  const { data: libraries = [], isLoading: librariesLoading } = usePlexLibraries()

  const searchTypeParam = typeFilter === 'all' ? undefined : typeFilter
  const { data: searchResults = [], isFetching: searchFetching } = usePlexSearch(
    debouncedSearch,
    searchTypeParam,
    isSearching,
  )

  const { data: libraryItems = [], isFetching: libraryFetching } = usePlexLibraryItems(
    selectedLibrary,
    loadLibrary && !isSearching,
  )

  const { data: assignmentsMap = {} } = useAssignments()
  const assign = useAssign()
  const unassign = useUnassign()

  const channelAssignments = assignmentsMap[channelNumber] ?? []
  const assignedKeys = useMemo(
    () => new Set(channelAssignments.map((a) => a.plex_rating_key)),
    [channelAssignments],
  )

  const rawItems: PlexItem[] = isSearching ? searchResults : loadLibrary ? libraryItems : []
  const filteredItems = useMemo(
    () => typeFilter === 'all' ? rawItems : rawItems.filter((i) => i.type === typeFilter),
    [rawItems, typeFilter],
  )

  const isLoading = isSearching ? searchFetching : libraryFetching

  function handleAssign(item: PlexItem) {
    assign.mutate({
      channel_number: channelNumber,
      plex_rating_key: item.rating_key,
      plex_title: item.title,
      plex_type: item.type,
      plex_thumb: item.thumb,
      plex_year: item.year,
    })
  }

  function handleUnassign(id: number) {
    unassign.mutate({ id, channelNumber })
  }

  function handleDetail(ratingKey: string) {
    openModal('itemDetail', { itemDetailRatingKey: ratingKey })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex-shrink-0 p-3 border-b border-slate-800 flex flex-col gap-2">
        {/* Library select + load button */}
        <div className="flex gap-2">
          <select
            value={selectedLibrary}
            onChange={(e) => {
              setSelectedLibrary(e.target.value)
              setLoadLibrary(false)
            }}
            disabled={librariesLoading}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          >
            <option value="">Select library…</option>
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.title} ({lib.type})
              </option>
            ))}
          </select>
          <button
            onClick={() => setLoadLibrary(true)}
            disabled={!selectedLibrary || isSearching}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg transition-colors whitespace-nowrap"
          >
            Browse library
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search Plex…"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-1">
          {(['all', 'show', 'movie'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {t === 'all' ? 'All' : t === 'show' ? 'Shows' : 'Movies'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {!isSearching && !loadLibrary ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <p>Search or browse a library</p>
          </div>
        ) : (
          <PosterGrid
            items={filteredItems}
            assignedKeys={assignedKeys}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
            assignments={channelAssignments}
            onDetail={handleDetail}
            loading={isLoading}
          />
        )}
      </div>
    </div>
  )
}
