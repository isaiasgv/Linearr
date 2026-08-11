/**
 * What is on this channel right now, for the channel view header.
 *
 * Renders nothing at all when the channel is not linked to Tunarr, or when the
 * EPG has no entry covering now — an un-materialized guide is an ordinary
 * state, and an empty box saying so would be worse than no box.
 */
import { useNowPlaying } from '../hooks'
import { describeProgram, formatClock } from '../nowPlaying'

interface Props {
  channelNumber: number
  /** False when the channel has no Tunarr link — there is nothing to show. */
  linked: boolean
  onOpenGuide?: () => void
  onWatch?: () => void
}

export function NowPlayingStrip({ channelNumber, linked, onOpenGuide, onWatch }: Props) {
  const { nowPlaying } = useNowPlaying(channelNumber, linked)
  if (!linked || !nowPlaying) return null

  const { current, next, progress, minutesRemaining, endsAt } = nowPlaying

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-slate-700/70 bg-slate-800/50 px-2.5 py-1.5">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-wide text-emerald-400 uppercase">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Now
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-100" title={describeProgram(current)}>
          {describeProgram(current)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <div
            className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-slate-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Programme progress"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
            {minutesRemaining}m left · ends {formatClock(endsAt)}
          </span>
        </div>
        {next?.title && (
          <p className="mt-0.5 truncate text-[10px] text-slate-500">
            Next: {describeProgram(next)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onWatch && (
          <button
            onClick={onWatch}
            title="Watch this channel"
            aria-label="Watch this channel"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-rose-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M10 8.5l6 3.5-6 3.5z" />
            </svg>
          </button>
        )}
        {onOpenGuide && (
          <button
            onClick={onOpenGuide}
            title="Open the programme guide"
            aria-label="Open the programme guide"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-amber-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
