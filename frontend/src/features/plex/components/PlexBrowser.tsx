import { useState, useMemo } from 'react'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useUIStore } from '@/shared/store/ui.store'
import { useAssignments, useAssign, useUnassign, useBulkAssign } from '@/features/assignments/hooks'
import {
  usePlexLibraries,
  usePlexLibraryItems,
  usePlexSearch,
  usePlexLibraryFilters,
  usePlexCollections,
  usePlexCollectionItems,
} from '@/features/plex/hooks'
import { PosterGrid } from './PosterGrid'
import type { PosterViewMode, PosterSize } from './PosterGrid'
import type { PlexItem } from '@/shared/types'

type TypeFilter = 'all' | 'show' | 'movie'
type Source = 'library' | 'collection'

interface PlexBrowserProps {
  channelNumber: number
}

export function PlexBrowser({ channelNumber }: PlexBrowserProps) {
  const openModal = useUIStore((s) => s.openModal)
  const viewMode = useUIStore((s) => s.browseViewMode)
  const setViewMode = useUIStore((s) => s.setBrowseViewMode)
  const posterSize = useUIStore((s) => s.browsePosterSize)
  const setPosterSize = useUIStore((s) => s.setBrowsePosterSize)

  const [source, setSource] = useState<Source>('library')
  const [selectedLibrary, setSelectedLibrary] = useState('')
  const [loadLibrary, setLoadLibrary] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [genreFilter, setGenreFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const debouncedSearch = useDebounce(searchInput, 400)
  const isSearching = debouncedSearch.trim().length > 0

  const { data: libraries = [], isLoading: librariesLoading } = usePlexLibraries()
  const { data: collections = [] } = usePlexCollections()

  const searchTypeParam = typeFilter === 'all' ? undefined : typeFilter
  const { data: searchResults = [], isFetching: searchFetching } = usePlexSearch(
    debouncedSearch,
    searchTypeParam,
    isSearching,
  )

  const { data: filterOptions } = usePlexLibraryFilters(selectedLibrary)

  const libraryFilters = useMemo(() => {
    const f: Record<string, string | number> = {}
    if (genreFilter) f.genre = genreFilter
    if (yearFilter) f.year = Number(yearFilter)
    if (ratingFilter) f.content_rating = ratingFilter
    return Object.keys(f).length > 0 ? f : undefined
  }, [genreFilter, yearFilter, ratingFilter])

  const { data: libraryItems = [], isFetching: libraryFetching } = usePlexLibraryItems(
    selectedLibrary,
    source === 'library' && loadLibrary && !isSearching,
    libraryFilters as { genre?: string; year?: number; content_rating?: string } | undefined,
  )

  const { data: collectionItems = [], isFetching: collectionFetching } = usePlexCollectionItems(
    source === 'collection' ? selectedCollection : '',
  )

  const { data: assignmentsMap = {} } = useAssignments()
  const assign = useAssign()
  const unassign = useUnassign()
  const bulkAssign = useBulkAssign()

  const channelAssignments = useMemo(
    () => assignmentsMap[channelNumber] ?? [],
    [assignmentsMap, channelNumber],
  )
  const assignedKeys = useMemo(
    () => new Set(channelAssignments.map((a) => a.plex_rating_key)),
    [channelAssignments],
  )

  const rawItems = useMemo<PlexItem[]>(
    () =>
      isSearching
        ? searchResults
        : source === 'collection'
          ? collectionItems
          : loadLibrary
            ? libraryItems
            : [],
    [isSearching, searchResults, source, collectionItems, loadLibrary, libraryItems],
  )
  const filteredItems = useMemo(
    () => (typeFilter === 'all' ? rawItems : rawItems.filter((i) => i.type === typeFilter)),
    [rawItems, typeFilter],
  )

  const isLoading = isSearching
    ? searchFetching
    : source === 'collection'
      ? collectionFetching
      : libraryFetching

  const activeFilterCount = [genreFilter, yearFilter, ratingFilter].filter(Boolean).length
  const unassignedCount = filteredItems.filter((i) => !assignedKeys.has(i.rating_key)).length

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

  function handleAddAll() {
    const items = filteredItems
      .filter((i) => !assignedKeys.has(i.rating_key))
      .map((i) => ({
        plex_rating_key: i.rating_key,
        plex_title: i.title,
        plex_type: i.type,
        plex_thumb: i.thumb,
        plex_year: i.year,
      }))
    if (items.length > 0) bulkAssign.mutate({ channelNumber, items })
  }

  function handleDetail(ratingKey: string) {
    openModal('itemDetail', { itemDetailRatingKey: ratingKey })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Slim sticky toolbar */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2 flex items-center gap-2 flex-wrap">
        {/* Source toggle */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['library', 'collection'] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                source === s ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'library' ? 'Library' : 'Collection'}
            </button>
          ))}
        </div>

        {/* Source picker */}
        {source === 'library' ? (
          <>
            <select
              value={selectedLibrary}
              onChange={(e) => {
                setSelectedLibrary(e.target.value)
                setLoadLibrary(false)
                setGenreFilter('')
                setYearFilter('')
                setRatingFilter('')
              }}
              disabled={librariesLoading}
              aria-label="Plex library"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
            >
              <option value="">Select library…</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => setLoadLibrary(true)}
              disabled={!selectedLibrary || isSearching}
              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs rounded-lg whitespace-nowrap"
            >
              Browse
            </button>
          </>
        ) : (
          <>
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              aria-label="Plex collection"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 max-w-[14rem]"
            >
              <option value="">Select collection…</option>
              {collections.map((c) => (
                <option key={c.rating_key} value={c.rating_key}>
                  {c.title} ({c.child_count})
                </option>
              ))}
            </select>
            <button
              onClick={handleAddAll}
              disabled={!selectedCollection || unassignedCount === 0 || bulkAssign.isPending}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs rounded-lg whitespace-nowrap"
            >
              Add all {unassignedCount > 0 ? unassignedCount : ''}
            </button>
          </>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[8rem]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            aria-label="Search Plex"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-0.5">
          {(['all', 'show', 'movie'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                typeFilter === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {t === 'all' ? 'All' : t === 'show' ? 'TV' : 'Movies'}
            </button>
          ))}
        </div>

        {/* View mode */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['wall', 'grid', 'list'] as PosterViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              className={`px-2 py-1 text-xs rounded-md capitalize transition-colors ${
                viewMode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Size */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['small', 'medium', 'large'] as PosterSize[]).map((s) => (
            <button
              key={s}
              onClick={() => setPosterSize(s)}
              title={s}
              className={`px-1.5 py-1 text-xs rounded-md transition-colors ${
                posterSize === s ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {s.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>

        {/* Filters popover (library only) */}
        {source === 'library' && selectedLibrary && filterOptions && (
          <div className="relative">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className="px-2.5 py-1 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 mt-1 z-20 bg-slate-900 border border-slate-700 rounded-lg p-2 flex flex-col gap-2 shadow-xl">
                {filterOptions.genres.length > 0 && (
                  <select
                    value={genreFilter}
                    onChange={(e) => { setGenreFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Genre"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Genres</option>
                    {filterOptions.genres.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                )}
                {filterOptions.years.length > 0 && (
                  <select
                    value={yearFilter}
                    onChange={(e) => { setYearFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Year"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Years</option>
                    {filterOptions.years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                {filterOptions.content_ratings.length > 0 && (
                  <select
                    value={ratingFilter}
                    onChange={(e) => { setRatingFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Content rating"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Ratings</option>
                    {filterOptions.content_ratings.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setGenreFilter(''); setYearFilter(''); setRatingFilter(''); setLoadLibrary(true) }}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {!isSearching && source === 'library' && !loadLibrary ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <p>Pick a library and hit Browse, search, or switch to Collection.</p>
          </div>
        ) : !isSearching && source === 'collection' && !selectedCollection ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <p>Pick a collection to preview its items, then “Add all”.</p>
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
            viewMode={viewMode}
            posterSize={posterSize}
          />
        )}
      </div>
    </div>
  )
}
