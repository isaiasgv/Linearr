import { useUIStore } from '@/shared/store/ui.store'

export function EmptyState() {
  const setActiveView = useUIStore((s) => s.setActiveView)

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div className="w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-6">
        <svg
          className="w-10 h-10 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <rect x="2" y="7" width="20" height="15" rx="2" />
          <path d="M17 2l-5 5-5-5" />
          <circle cx="12" cy="14" r="2" />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-slate-100 mb-2">
        Select a channel to manage assignments
      </h2>
      <p className="text-sm text-slate-500 mb-8">or browse your Plex library to explore content</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => setActiveView('cableplex')}
          className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/50 hover:border-amber-600 text-amber-300 rounded-lg text-sm font-medium transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M15 10l-4 4 4 4" />
            <rect x="2" y="3" width="20" height="18" rx="2" />
          </svg>
          Cable Plex
        </button>

        <button
          onClick={() => setActiveView('generic')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-700/50 hover:border-indigo-600 text-indigo-300 rounded-lg text-sm font-medium transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Generic Blocks
        </button>

        <button
          onClick={() => setActiveView('tunarr')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/50 hover:border-emerald-600 text-emerald-300 rounded-lg text-sm font-medium transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          Tunarr
        </button>
      </div>
    </div>
  )
}
