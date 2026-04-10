import {
  usePlexServerInfo,
  usePlexLibraryStats,
  usePlexRecentlyAdded,
  usePlexOnDeck,
  usePlexPopular,
} from '@/features/plex/hooks'
import { Spinner } from '@/shared/components/ui/Spinner'

export function PlexView() {
  const { data: serverInfo, isLoading: loadingServer, isError: serverError } = usePlexServerInfo()
  const { data: libraryStats = [], isLoading: loadingStats } = usePlexLibraryStats()
  const { data: recentItems = [], isLoading: loadingRecent } = usePlexRecentlyAdded(30)
  const { data: onDeckItems = [], isLoading: loadingOnDeck } = usePlexOnDeck(20)
  const { data: popularItems = [], isLoading: loadingPopular } = usePlexPopular(30)

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
                    <span className="ml-2 bg-amber-600/40 text-amber-200 rounded-full px-2 py-0.5 text-xs">
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

        {/* Library Stats */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Libraries</h3>
          {loadingStats ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {libraryStats.map((lib) => (
                <div
                  key={lib.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-colors"
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
                  <p className="text-sm font-semibold text-slate-100 truncate">{lib.title}</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {lib.total_items.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">items</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recently Added */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Recently Added</h3>
          {loadingRecent ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : recentItems.length === 0 ? (
            <p className="text-sm text-slate-500">No recent items</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
              {recentItems.map((item) => (
                <div key={item.rating_key} className="shrink-0 w-28">
                  <div
                    className="relative rounded-lg overflow-hidden bg-slate-800 mb-1.5"
                    style={{ aspectRatio: '2/3' }}
                  >
                    {item.thumb ? (
                      <img
                        src={`/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`}
                        alt={item.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
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
                    <span
                      className={`absolute top-1 right-1 text-xs rounded px-1 py-0.5 font-medium shadow ${
                        item.type === 'movie'
                          ? 'bg-purple-600/80 text-white'
                          : 'bg-blue-600/80 text-white'
                      }`}
                    >
                      {item.type === 'movie' ? 'Movie' : 'TV'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                  {item.year && <p className="text-xs text-slate-500">{item.year}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* On Deck */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">On Deck</h3>
          {loadingOnDeck ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : onDeckItems.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing on deck</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
              {onDeckItems.map((item) => (
                <div key={item.rating_key} className="shrink-0 w-28">
                  <div
                    className="relative rounded-lg overflow-hidden bg-slate-800 mb-1.5"
                    style={{ aspectRatio: '2/3' }}
                  >
                    {item.thumb ? (
                      <img
                        src={`/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`}
                        alt={item.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
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
                    <span
                      className={`absolute top-1 right-1 text-xs rounded px-1 py-0.5 font-medium shadow ${
                        item.type === 'movie'
                          ? 'bg-purple-600/80 text-white'
                          : 'bg-blue-600/80 text-white'
                      }`}
                    >
                      {item.type === 'movie' ? 'Movie' : 'TV'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                  {item.subtitle && (
                    <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Popular in Your Library */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Popular in Your Library</h3>
          {loadingPopular ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : popularItems.length === 0 ? (
            <p className="text-sm text-slate-500">No watch history yet</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
              {popularItems.map((item) => (
                <div key={item.rating_key} className="shrink-0 w-28">
                  <div
                    className="relative rounded-lg overflow-hidden bg-slate-800 mb-1.5"
                    style={{ aspectRatio: '2/3' }}
                  >
                    {item.thumb ? (
                      <img
                        src={`/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`}
                        alt={item.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
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
                    <span
                      className={`absolute top-1 right-1 text-xs rounded px-1 py-0.5 font-medium shadow ${
                        item.type === 'movie'
                          ? 'bg-purple-600/80 text-white'
                          : 'bg-blue-600/80 text-white'
                      }`}
                    >
                      {item.type === 'movie' ? 'Movie' : 'TV'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                  {item.year && <p className="text-xs text-slate-500">{item.year}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
