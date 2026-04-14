import { useState, memo } from 'react'
import {
  usePlexServerInfo,
  usePlexLibraryStats,
  usePlexRecentlyAdded,
  usePlexOnDeck,
  usePlexPopular,
  usePlexLibraryItems,
  usePlexSessions,
  usePlexHistory,
  usePlexPlaylists,
  useScanLibrary,
  usePlexHubs,
  usePlexEvents,
  useClearPlexEvents,
  useDeleteCollection,
  usePlexCollections,
  usePlexCollectionItems,
} from '@/features/plex/hooks'
import { useUIStore } from '@/shared/store/ui.store'
import { Spinner } from '@/shared/components/ui/Spinner'
import { PlexThumb } from '@/features/plex/components/PlexThumb'

/** Clickable poster card used throughout the view */
const PosterCard = memo(function PosterCard({
  ratingKey,
  thumb,
  title,
  year,
  type,
  subtitle,
}: {
  ratingKey: string
  thumb: string | null
  title: string
  year?: number | null
  type?: string
  subtitle?: string | null
}) {
  const openModal = useUIStore((s) => s.openModal)
  return (
    <button
      onClick={() => openModal('itemDetail', { itemDetailRatingKey: ratingKey })}
      className="shrink-0 w-28 text-left group"
    >
      <div
        className="relative rounded-lg overflow-hidden bg-slate-800 mb-1.5 group-hover:ring-2 ring-indigo-500 transition-all"
        style={{ aspectRatio: '2/3' }}
      >
        {thumb ? (
          <PlexThumb
            path={thumb}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1}
            >
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <circle cx="12" cy="14" r="3" />
            </svg>
          </div>
        )}
        {type && (
          <span
            className={`absolute top-1 right-1 text-xs rounded px-1 py-0.5 font-medium shadow ${
              type === 'movie' ? 'bg-purple-600/80 text-white' : 'bg-blue-600/80 text-white'
            }`}
          >
            {type === 'movie' ? 'Movie' : 'TV'}
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
        {title}
      </p>
      {subtitle ? (
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
      ) : year ? (
        <p className="text-xs text-slate-500">{year}</p>
      ) : null}
    </button>
  )
})

/** Horizontal scrollable row of poster cards */
function PosterRow({
  title,
  items,
  loading,
  emptyText,
}: {
  title: string
  items: Array<{
    rating_key: string
    title: string
    thumb: string | null
    year?: number | null
    type?: string
    subtitle?: string | null
  }>
  loading: boolean
  emptyText: string
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
          {items.map((item) => (
            <PosterCard
              key={item.rating_key}
              ratingKey={item.rating_key}
              thumb={item.thumb}
              title={item.title}
              year={item.year}
              type={item.type}
              subtitle={item.subtitle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Library browse panel — shown when user clicks a library */
function LibraryBrowser({
  sectionId,
  libraryTitle,
  onClose,
}: {
  sectionId: string
  libraryTitle: string
  onClose: () => void
}) {
  const { data: items = [], isLoading } = usePlexLibraryItems(sectionId, true)
  const [filter, setFilter] = useState<'all' | 'movie' | 'show'>('all')
  const [search, setSearch] = useState('')

  const filtered = items.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <h3 className="text-sm font-semibold text-slate-200">{libraryTitle}</h3>
          <span className="text-xs text-slate-500">
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
            {(['all', 'movie', 'show'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  filter === f ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f === 'all' ? 'All' : f === 'movie' ? 'Movies' : 'Shows'}
              </button>
            ))}
          </div>
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500"
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              className="w-40 bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filtered.map((item) => (
            <PosterCard
              key={item.rating_key}
              ratingKey={item.rating_key}
              thumb={item.thumb}
              title={item.title}
              year={item.year}
              type={item.type}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Collection content viewer */
function CollectionBrowser({
  ratingKey,
  collectionTitle,
  onClose,
}: {
  ratingKey: string
  collectionTitle: string
  onClose: () => void
}) {
  const { data: items = [], isLoading } = usePlexCollectionItems(ratingKey)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
        <h3 className="text-sm font-semibold text-slate-200">{collectionTitle}</h3>
        <span className="text-xs text-slate-500">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {items.map((item) => (
            <PosterCard
              key={item.rating_key}
              ratingKey={item.rating_key}
              thumb={item.thumb}
              title={item.title}
              year={item.year}
              type={item.type}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function PlexView() {
  const { data: serverInfo, isLoading: loadingServer, isError: serverError } = usePlexServerInfo()
  const { data: libraryStats = [], isLoading: loadingStats } = usePlexLibraryStats()
  const { data: recentItems = [], isLoading: loadingRecent } = usePlexRecentlyAdded(30)
  const { data: onDeckItems = [], isLoading: loadingOnDeck } = usePlexOnDeck(20)
  const { data: popularItems = [], isLoading: loadingPopular } = usePlexPopular(30)
  const { data: sessions = [] } = usePlexSessions()
  const { data: historyItems = [] } = usePlexHistory(30)
  const { data: playlists = [] } = usePlexPlaylists()
  const scanLibrary = useScanLibrary()
  const { data: hubsData } = usePlexHubs()
  const { data: plexEvents = [] } = usePlexEvents(undefined, 20)
  const clearEvents = useClearPlexEvents()
  const { data: allCollections = [] } = usePlexCollections()
  const deleteCollection = useDeleteCollection()

  const [browsingLibrary, setBrowsingLibrary] = useState<{
    id: string
    title: string
  } | null>(null)
  const [browsingCollection, setBrowsingCollection] = useState<{
    ratingKey: string
    title: string
  } | null>(null)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <h1 className="text-xl font-bold text-slate-100">Plex Server</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Server info, library stats, and recently added content
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Server Info Card */}
        {loadingServer ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : serverError ? (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-300">
            Could not connect to Plex. Check Settings.
          </div>
        ) : serverInfo ? (
          <div className="bg-gradient-to-r from-amber-950/30 to-slate-900 border border-amber-800/30 rounded-xl p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-amber-600 flex items-center justify-center shrink-0">
                <img src="/plex.svg" alt="Plex" className="w-7 h-7 rounded" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{serverInfo.server_name}</h2>
                <p className="text-xs text-amber-300/60">
                  {serverInfo.username}
                  {serverInfo.plex_pass && (
                    <span className="ml-2 inline-flex items-center gap-1 bg-amber-600/40 text-amber-200 rounded-full px-2 py-0.5 text-xs">
                      <img src="/plexpass.svg" alt="" className="w-3.5 h-3.5" />
                      Plex Pass
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Version</p>
                <p className="text-sm font-mono text-slate-200">{serverInfo.version}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Platform</p>
                <p className="text-sm text-slate-200">{serverInfo.platform}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Libraries</p>
                <p className="text-sm font-semibold text-amber-400">{serverInfo.library_count}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Machine ID</p>
                <p className="text-xs font-mono text-slate-400 truncate">{serverInfo.machine_id}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Now Playing — always visible at top when active */}
        {sessions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Now Playing
              <span className="text-xs text-slate-500 font-normal">
                {sessions.length} active stream{sessions.length !== 1 ? 's' : ''}
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sessions.map((s, i) => (
                <div
                  key={i}
                  className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-xl overflow-hidden"
                >
                  <div className="flex gap-3 p-3">
                    {/* Poster */}
                    <div className="w-16 h-24 rounded-lg overflow-hidden bg-slate-950 shrink-0 shadow-lg">
                      <PlexThumb
                        path={s.thumb}
                        alt={s.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-100 truncate">{s.title}</p>
                        {s.subtitle && (
                          <p className="text-xs text-slate-400 truncate mt-0.5">{s.subtitle}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {/* Progress bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all duration-1000"
                              style={{ width: `${s.progress_pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">
                            {s.progress_pct}%
                          </span>
                        </div>
                        {/* Meta row */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[10px] bg-slate-700/60 text-slate-300 rounded px-1.5 py-0.5">
                            <svg
                              className="w-2.5 h-2.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            {s.user}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] bg-slate-700/60 text-slate-400 rounded px-1.5 py-0.5">
                            <svg
                              className="w-2.5 h-2.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <rect x="2" y="7" width="20" height="15" rx="2" />
                              <path d="M17 2l-5 5-5-5" />
                            </svg>
                            {s.player}
                          </span>
                          {s.video_resolution && (
                            <span className="text-[10px] bg-indigo-900/40 text-indigo-300 rounded px-1.5 py-0.5 font-medium">
                              {s.video_resolution}p
                            </span>
                          )}
                          {s.transcode && (
                            <span className="text-[10px] bg-amber-900/40 text-amber-300 rounded px-1.5 py-0.5">
                              Transcode
                            </span>
                          )}
                          {s.state === 'paused' && (
                            <span className="text-[10px] bg-yellow-900/40 text-yellow-300 rounded px-1.5 py-0.5">
                              Paused
                            </span>
                          )}
                          {s.bandwidth_kbps != null && s.bandwidth_kbps > 0 && (
                            <span className="text-[10px] text-slate-500">
                              {s.bandwidth_kbps > 1000
                                ? `${(s.bandwidth_kbps / 1000).toFixed(1)} Mbps`
                                : `${s.bandwidth_kbps} kbps`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collection browsing mode */}
        {browsingCollection ? (
          <CollectionBrowser
            ratingKey={browsingCollection.ratingKey}
            collectionTitle={browsingCollection.title}
            onClose={() => setBrowsingCollection(null)}
          />
        ) : browsingLibrary ? (
          <LibraryBrowser
            sectionId={browsingLibrary.id}
            libraryTitle={browsingLibrary.title}
            onClose={() => setBrowsingLibrary(null)}
          />
        ) : (
          <>
            {/* Library Stats — clickable cards */}
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Libraries</h3>
              {loadingStats ? (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {libraryStats.map((lib) => (
                    <button
                      key={lib.id}
                      onClick={() => setBrowsingLibrary({ id: lib.id, title: lib.title })}
                      className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-indigo-500 hover:bg-slate-800/80 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            lib.type === 'movie'
                              ? 'bg-purple-900/50 text-purple-400'
                              : 'bg-blue-900/50 text-blue-400'
                          }`}
                        >
                          {lib.type === 'movie' ? (
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                            >
                              <rect x="2" y="7" width="20" height="15" rx="2" />
                              <circle cx="12" cy="14" r="2" />
                            </svg>
                          ) : (
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                            >
                              <rect x="2" y="3" width="20" height="18" rx="2" />
                              <path d="M8 10h8M8 14h5" />
                            </svg>
                          )}
                        </div>
                        <span
                          className={`text-xs rounded-full px-1.5 py-0.5 font-medium ${
                            lib.type === 'movie'
                              ? 'bg-purple-900/40 text-purple-300'
                              : 'bg-blue-900/40 text-blue-300'
                          }`}
                        >
                          {lib.type === 'movie' ? 'Movies' : 'Shows'}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                        {lib.title}
                      </p>
                      <p className="text-2xl font-bold text-white mt-1">
                        {lib.total_items.toLocaleString()}
                      </p>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500">items</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            scanLibrary.mutate(lib.id)
                          }}
                          className="text-xs text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Scan library"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                          </svg>
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Recently Added */}
            <PosterRow
              title="Recently Added"
              items={recentItems}
              loading={loadingRecent}
              emptyText="No recent items"
            />

            {/* On Deck */}
            <PosterRow
              title="On Deck"
              items={onDeckItems}
              loading={loadingOnDeck}
              emptyText="Nothing on deck"
            />

            {/* Popular in Your Library */}
            <PosterRow
              title="Popular in Your Library"
              items={popularItems}
              loading={loadingPopular}
              emptyText="No watch history yet"
            />

            {/* Plex Hubs (Discovery) */}
            {hubsData?.hubs && hubsData.hubs.length > 0 && (
              <>
                {hubsData.hubs.map((hub) => (
                  <PosterRow
                    key={hub.hub_key || hub.title}
                    title={hub.title}
                    items={hub.items.map((i) => ({
                      rating_key: i.rating_key,
                      title: i.title,
                      thumb: i.thumb,
                      year: i.year,
                      type: i.type,
                      subtitle: i.subtitle,
                    }))}
                    loading={false}
                    emptyText=""
                  />
                ))}
              </>
            )}

            {/* Watch History */}
            {historyItems.length > 0 && (
              <PosterRow
                title="Watch History"
                items={historyItems.map((h) => ({
                  rating_key: h.rating_key,
                  title: h.title,
                  thumb: h.thumb,
                  type: h.type,
                  subtitle: h.subtitle,
                }))}
                loading={false}
                emptyText="No history"
              />
            )}

            {/* Playlists */}
            {playlists.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Playlists</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {playlists.map((pl) => (
                    <div
                      key={pl.rating_key}
                      className="bg-slate-800 border border-slate-700 rounded-xl p-3 hover:border-slate-600 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-900/50 flex items-center justify-center shrink-0">
                          <svg
                            className="w-4 h-4 text-indigo-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                          >
                            <path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </div>
                        {pl.smart && (
                          <span className="text-xs bg-amber-900/40 text-amber-300 rounded-full px-1.5 py-0.5">
                            Smart
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-100 truncate">{pl.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {pl.item_count} item{pl.item_count !== 1 ? 's' : ''}
                        {pl.type && ` • ${pl.type}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collections */}
            {allCollections.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Collections</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {allCollections.map((coll) => (
                    <div
                      key={coll.rating_key}
                      onClick={() =>
                        setBrowsingCollection({ ratingKey: coll.rating_key, title: coll.title })
                      }
                      className="bg-slate-800 border border-slate-700 rounded-xl p-3 hover:border-slate-600 transition-colors group relative cursor-pointer"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {coll.thumb ? (
                          <PlexThumb
                            path={coll.thumb}
                            alt={coll.title}
                            className="w-8 h-8 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-purple-900/50 flex items-center justify-center shrink-0">
                            <svg
                              className="w-4 h-4 text-purple-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                            >
                              <rect x="3" y="3" width="7" height="7" rx="1" />
                              <rect x="14" y="3" width="7" height="7" rx="1" />
                              <rect x="3" y="14" width="7" height="7" rx="1" />
                              <rect x="14" y="14" width="7" height="7" rx="1" />
                            </svg>
                          </div>
                        )}
                        <span
                          className={`text-xs rounded-full px-1.5 py-0.5 ${coll.type === 'movie' ? 'bg-purple-900/40 text-purple-300' : 'bg-blue-900/40 text-blue-300'}`}
                        >
                          {coll.type === 'movie' ? 'Movies' : 'Shows'}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-100 truncate">{coll.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {coll.child_count} item{coll.child_count !== 1 ? 's' : ''}
                      </p>
                      <button
                        onClick={() => deleteCollection.mutate(coll.rating_key)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-red-900/60 hover:bg-red-900 rounded text-red-400"
                        title="Delete collection"
                      >
                        <svg
                          className="w-3 h-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Webhook Event Feed */}
            {plexEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-300">Recent Events</h3>
                  <button
                    onClick={() => clearEvents.mutate()}
                    disabled={clearEvents.isPending}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {plexEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg"
                    >
                      <span
                        className={`shrink-0 w-2 h-2 rounded-full ${
                          ev.event_type === 'library.new'
                            ? 'bg-emerald-400'
                            : ev.event_type.startsWith('media.play')
                              ? 'bg-blue-400'
                              : ev.event_type === 'media.scrobble'
                                ? 'bg-amber-400'
                                : 'bg-slate-500'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 truncate">
                          <span className="text-slate-500">
                            {ev.event_type.replace('media.', '').replace('library.', '')}
                          </span>
                          {ev.title && <> — {ev.title}</>}
                        </p>
                        <p className="text-[10px] text-slate-600">
                          {ev.user_name && <>{ev.user_name} • </>}
                          {new Date(ev.created_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
