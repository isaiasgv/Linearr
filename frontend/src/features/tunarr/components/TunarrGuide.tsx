import { useMemo, useRef, useEffect } from 'react'
import { useTunarrGuide } from '@/features/tunarr/hooks'
import { Spinner } from '@/shared/components/ui/Spinner'

const SLOT_WIDTH = 120 // px per 30-min slot
const CHANNEL_COL_WIDTH = 180
const ROW_HEIGHT = 56

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function generateTimeSlots(hours: number): number[] {
  const now = new Date()
  now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0)
  const start = now.getTime()
  const slots: number[] = []
  for (let i = 0; i < hours * 2; i++) {
    slots.push(start + i * 30 * 60 * 1000)
  }
  return slots
}

interface ProgramBarProps {
  title: string
  episode?: { title?: string; season?: number; episode?: number }
  startMs: number
  durationMs: number
  timelineStart: number
}

function ProgramBar({ title, episode, startMs, durationMs, timelineStart }: ProgramBarProps) {
  const left = ((startMs - timelineStart) / (30 * 60 * 1000)) * SLOT_WIDTH
  const width = Math.max((durationMs / (30 * 60 * 1000)) * SLOT_WIDTH, 40)
  const epLabel = episode?.season != null && episode?.episode != null
    ? `S${episode.season}E${episode.episode}`
    : ''

  return (
    <div
      className="absolute top-1 bottom-1 bg-indigo-900/60 border border-indigo-700/50 rounded px-1.5 py-0.5 overflow-hidden hover:bg-indigo-800/70 hover:border-indigo-600 transition-colors cursor-default group"
      style={{ left: `${left}px`, width: `${width}px` }}
      title={`${title}${epLabel ? ` (${epLabel})` : ''}\n${formatTime(startMs)} — ${formatTime(startMs + durationMs)}`}
    >
      <p className="text-xs font-medium text-slate-200 truncate leading-tight">{title}</p>
      {epLabel && <p className="text-xs text-indigo-400/70 truncate leading-tight">{epLabel}</p>}
    </div>
  )
}

interface TunarrGuideProps {
  onClose?: () => void
}

export function TunarrGuide({ onClose }: TunarrGuideProps) {
  const { data, isLoading, isError } = useTunarrGuide(24)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timeSlots = useMemo(() => generateTimeSlots(24), [])
  const timelineStart = timeSlots[0] ?? Date.now()
  const totalWidth = timeSlots.length * SLOT_WIDTH

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = Date.now()
      const offset = ((now - timelineStart) / (30 * 60 * 1000)) * SLOT_WIDTH - 200
      scrollRef.current.scrollLeft = Math.max(0, offset)
    }
  }, [timelineStart])

  const channels = data?.channels ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-100">Program Guide</h2>
          <p className="text-xs text-slate-500">{channels.length} channel{channels.length !== 1 ? 's' : ''} linked to Tunarr</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
      ) : isError ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-400">Failed to load guide. Is Tunarr connected?</p>
        </div>
      ) : channels.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-slate-500">No channels linked to Tunarr. Link channels first.</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Channel names column (fixed) */}
          <div className="shrink-0 border-r border-slate-800 overflow-hidden" style={{ width: CHANNEL_COL_WIDTH }}>
            {/* Time header spacer */}
            <div className="h-8 border-b border-slate-800 bg-slate-900/50 flex items-center px-3">
              <span className="text-xs text-slate-500 font-medium">Channel</span>
            </div>
            {/* Channel rows */}
            <div className="overflow-y-auto" style={{ height: `calc(100% - 32px)` }}>
              {channels.map((ch) => (
                <div
                  key={ch.tunarr_id}
                  className="flex items-center gap-2 px-3 border-b border-slate-800/50 hover:bg-slate-900/50"
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="text-xs font-mono bg-slate-800 text-slate-400 rounded px-1.5 py-0.5 shrink-0">
                    {ch.tunarr_number ?? ch.channel_number}
                  </span>
                  <span className="text-sm text-slate-200 truncate">{ch.tunarr_name || `Ch ${ch.channel_number}`}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scrollable timeline */}
          <div ref={scrollRef} className="flex-1 overflow-auto" style={{ scrollbarWidth: 'thin' }}>
            {/* Time header */}
            <div className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur-sm border-b border-slate-800 flex" style={{ width: totalWidth, height: 32 }}>
              {timeSlots.map((ts) => (
                <div
                  key={ts}
                  className="shrink-0 flex items-center px-2 border-r border-slate-800/30 text-xs text-slate-500"
                  style={{ width: SLOT_WIDTH }}
                >
                  {formatTime(ts)}
                </div>
              ))}
            </div>

            {/* Program rows */}
            {channels.map((ch) => (
              <div
                key={ch.tunarr_id}
                className="relative border-b border-slate-800/30"
                style={{ width: totalWidth, height: ROW_HEIGHT }}
              >
                {/* Background grid lines */}
                <div className="absolute inset-0 flex">
                  {timeSlots.map((ts) => (
                    <div key={ts} className="shrink-0 border-r border-slate-800/20" style={{ width: SLOT_WIDTH }} />
                  ))}
                </div>
                {/* Programs */}
                {ch.schedule.map((item, idx) => {
                  const startMs = typeof item.startTime === 'number' ? item.startTime : new Date(item.startTime).getTime()
                  const durationMs = item.duration
                  if (isNaN(startMs) || startMs + durationMs < timelineStart) return null
                  if (startMs > timelineStart + timeSlots.length * 30 * 60 * 1000) return null
                  return (
                    <ProgramBar
                      key={`${ch.tunarr_id}-${idx}`}
                      title={item.title}
                      episode={item.episode}
                      startMs={startMs}
                      durationMs={durationMs}
                      timelineStart={timelineStart}
                    />
                  )
                })}
              </div>
            ))}

            {/* Current time indicator */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
              style={{ left: `${CHANNEL_COL_WIDTH + ((Date.now() - timelineStart) / (30 * 60 * 1000)) * SLOT_WIDTH}px` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
