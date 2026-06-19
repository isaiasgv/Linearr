import { Spinner } from '@/shared/components/ui/Spinner'
import { PlexThumb } from './PlexThumb'
import type { Assignment, PlexItem } from '@/shared/types'

export type PosterViewMode = 'grid' | 'list'
export type PosterSize = 'small' | 'medium' | 'large'

// Grid column counts per poster size — static strings so Tailwind keeps them.
const GRID_COLS: Record<PosterSize, string> = {
  small: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
  medium: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6',
  large: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
}

// List-row thumbnail size per poster size.
const LIST_THUMB: Record<PosterSize, string> = {
  small: 'w-8 h-12',
  medium: 'w-10 h-14',
  large: 'w-14 h-20',
}

interface PosterGridProps {
  items: PlexItem[]
  assignedKeys: Set<string>
  onAssign: (item: PlexItem) => void
  onUnassign: (id: number) => void
  assignments: Assignment[]
  onDetail?: (ratingKey: string) => void
  loading?: boolean
  viewMode?: PosterViewMode
  posterSize?: PosterSize
}

export function PosterGrid({
  items,
  assignedKeys,
  onAssign,
  onUnassign,
  assignments,
  onDetail,
  loading = false,
  viewMode = 'grid',
  posterSize = 'medium',
}: PosterGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
        No items to display
      </div>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-1.5 p-4">
        {items.map((item) => {
          const isAssigned = assignedKeys.has(item.rating_key)
          const assignment = assignments.find((a) => a.plex_rating_key === item.rating_key)

          return (
            <div
              key={item.rating_key}
              className={`group flex items-center gap-3 rounded-lg border transition-all px-2 py-1.5 ${
                isAssigned
                  ? 'border-emerald-600 bg-slate-800'
                  : 'border-slate-700 bg-slate-800 hover:border-slate-500'
              }`}
            >
              {/* Thumbnail */}
              <button
                onClick={() => onDetail?.(item.rating_key)}
                className={`${LIST_THUMB[posterSize]} shrink-0 rounded overflow-hidden bg-slate-900 relative`}
              >
                {item.thumb ? (
                  <PlexThumb
                    path={item.thumb}
                    alt={item.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-slate-700"
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
              </button>

              {/* Title + meta */}
              <button
                onClick={() => onDetail?.(item.rating_key)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                  {item.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {item.year && <span className="text-xs text-slate-500">{item.year}</span>}
                  <span
                    className={`text-xs px-1 py-0.5 rounded font-medium ${
                      item.type === 'show'
                        ? 'bg-blue-900/40 text-blue-400'
                        : 'bg-purple-900/40 text-purple-400'
                    }`}
                  >
                    {item.type === 'show' ? 'TV' : 'Movie'}
                  </span>
                </div>
              </button>

              {/* Action */}
              {isAssigned && assignment ? (
                <button
                  onClick={() => onUnassign(assignment.id)}
                  className="shrink-0 px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg font-medium transition-colors"
                >
                  Unassign
                </button>
              ) : (
                <button
                  onClick={() => onAssign(item)}
                  className="shrink-0 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg font-medium transition-colors"
                >
                  Assign
                </button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={`grid ${GRID_COLS[posterSize]} gap-3 p-4`}>
      {items.map((item) => {
        const isAssigned = assignedKeys.has(item.rating_key)
        const assignment = assignments.find((a) => a.plex_rating_key === item.rating_key)

        return (
          <div
            key={item.rating_key}
            className={`group relative rounded-lg overflow-hidden border transition-all ${
              isAssigned
                ? 'border-emerald-600 bg-slate-800'
                : 'border-slate-700 bg-slate-800 hover:border-slate-500'
            }`}
          >
            {/* Poster image */}
            <div
              className="relative aspect-[2/3] bg-slate-900 overflow-hidden cursor-pointer"
              onClick={() => onDetail?.(item.rating_key)}
            >
              {item.thumb ? (
                <PlexThumb
                  path={item.thumb}
                  alt={item.title}
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

              {/* Assigned overlay */}
              {isAssigned && (
                <div className="absolute top-1.5 right-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow">
                    <svg
                      className="w-3 h-3 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                </div>
              )}

              {/* Hover action overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                {isAssigned && assignment ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnassign(assignment.id)
                    }}
                    className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg font-medium transition-colors"
                  >
                    Unassign
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onAssign(item)
                    }}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg font-medium transition-colors"
                  >
                    Assign
                  </button>
                )}
              </div>
            </div>

            {/* Info bar */}
            <div className="px-2 py-1.5">
              <button onClick={() => onDetail?.(item.rating_key)} className="w-full text-left">
                <p className="text-xs font-medium text-slate-200 truncate hover:text-indigo-300 transition-colors">
                  {item.title}
                </p>
              </button>
              <div className="flex items-center gap-1.5 mt-0.5">
                {item.year && <span className="text-xs text-slate-500">{item.year}</span>}
                <span
                  className={`text-xs px-1 py-0.5 rounded font-medium ${
                    item.type === 'show'
                      ? 'bg-blue-900/40 text-blue-400'
                      : 'bg-purple-900/40 text-purple-400'
                  }`}
                >
                  {item.type === 'show' ? 'TV' : 'Movie'}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
