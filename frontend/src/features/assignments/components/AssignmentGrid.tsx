import { useState } from 'react'
import { useUIStore, type AssignedTypeFilter } from '@/shared/store/ui.store'
import { useChannelAssignments, useUnassign } from '@/features/assignments/hooks'
import { PlexThumb } from '@/features/plex/components/PlexThumb'
import { Spinner } from '@/shared/components/ui/Spinner'

interface AssignmentGridProps {
  channelNumber: number
}

type GridSize = 'small' | 'medium' | 'large'

const GRID_CLASSES: Record<GridSize, string> = {
  small: 'grid-cols-5 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10',
  medium: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
  large: 'grid-cols-3 xl:grid-cols-4',
}

const TYPE_FILTERS: { label: string; value: AssignedTypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Shows', value: 'tv' },
  { label: 'Movies', value: 'movies' },
]

export function AssignmentGrid({ channelNumber }: AssignmentGridProps) {
  const { assignedTypeFilter, setAssignedTypeFilter } = useUIStore()
  const [gridSize, setGridSize] = useState<GridSize>('medium')
  const { data: assignments = [], isLoading } = useChannelAssignments(channelNumber)
  const unassign = useUnassign()

  const filtered = assignments.filter((a) => {
    if (assignedTypeFilter === 'all') return true
    if (assignedTypeFilter === 'tv') return a.plex_type === 'show'
    if (assignedTypeFilter === 'movies') return a.plex_type === 'movie'
    return true
  })

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-800">
        <span className="text-xs text-slate-500 font-medium mr-1">Filter:</span>
        {TYPE_FILTERS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setAssignedTypeFilter(value)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              assignedTypeFilter === value
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {label}
            {value === 'all' && (
              <span className="ml-1 text-xs opacity-70">({assignments.length})</span>
            )}
          </button>
        ))}

        {/* Size toggle */}
        <div className="ml-auto flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {([
            { value: 'small' as GridSize, icon: 'M4 5h16M4 9h16M4 13h16M4 17h16M4 21h16' },
            { value: 'medium' as GridSize, icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
            { value: 'large' as GridSize, icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' },
          ]).map(({ value, icon }) => (
            <button
              key={value}
              onClick={() => setGridSize(value)}
              title={value.charAt(0).toUpperCase() + value.slice(1)}
              className={`p-1 rounded transition-colors ${
                gridSize === value ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <circle cx="12" cy="14" r="2" />
            </svg>
            <p className="text-sm">No content assigned</p>
          </div>
        ) : (
          <div className={`grid ${GRID_CLASSES[gridSize]} gap-3 p-4`}>
            {filtered.map((a) => (
              <div
                key={a.id}
                className="group relative rounded-lg overflow-hidden border border-slate-700 bg-slate-800 hover:border-slate-600 transition-all"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-slate-900 overflow-hidden">
                  {a.plex_thumb ? (
                    <PlexThumb
                      path={a.plex_thumb}
                      alt={a.plex_title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg
                        className="w-10 h-10 text-slate-700"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1}
                      >
                        <rect x="2" y="7" width="20" height="15" rx="2" />
                        <circle cx="12" cy="14" r="3" />
                      </svg>
                    </div>
                  )}

                  {/* Unassign hover overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                    <button
                      onClick={() => unassign.mutate({ id: a.id, channelNumber })}
                      disabled={unassign.isPending}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs rounded-lg font-medium transition-colors"
                    >
                      Unassign
                    </button>
                  </div>
                </div>

                {/* Info */}
                <div className="px-2 py-1.5">
                  <p className="text-xs font-medium text-slate-200 truncate">{a.plex_title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {a.plex_year && (
                      <span className="text-xs text-slate-500">{a.plex_year}</span>
                    )}
                    <span
                      className={`text-xs px-1 py-0.5 rounded font-medium ${
                        a.plex_type === 'show'
                          ? 'bg-blue-900/40 text-blue-400'
                          : 'bg-purple-900/40 text-purple-400'
                      }`}
                    >
                      {a.plex_type === 'show' ? 'TV' : 'Movie'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
