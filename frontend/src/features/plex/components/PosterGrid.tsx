import { Spinner } from '@/shared/components/ui/Spinner'
import { PlexThumb } from './PlexThumb'
import type { Assignment, PlexItem } from '@/shared/types'

interface PosterGridProps {
  items: PlexItem[]
  assignedKeys: Set<string>
  onAssign: (item: PlexItem) => void
  onUnassign: (id: number) => void
  assignments: Assignment[]
  onDetail?: (ratingKey: string) => void
  loading?: boolean
}

export function PosterGrid({
  items,
  assignedKeys,
  onAssign,
  onUnassign,
  assignments,
  onDetail,
  loading = false,
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

  return (
    <div className="grid grid-cols-3 xl:grid-cols-4 gap-3 p-4">
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
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
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
              <button
                onClick={() => onDetail?.(item.rating_key)}
                className="w-full text-left"
              >
                <p className="text-xs font-medium text-slate-200 truncate hover:text-indigo-300 transition-colors">
                  {item.title}
                </p>
              </button>
              <div className="flex items-center gap-1.5 mt-0.5">
                {item.year && (
                  <span className="text-xs text-slate-500">{item.year}</span>
                )}
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
