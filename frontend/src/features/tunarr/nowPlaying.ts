/**
 * What is on a channel right now, derived from the Tunarr EPG.
 *
 * Pure and time-injectable so it can be reasoned about and tested — "now" is a
 * parameter, never `Date.now()` read inside.
 */
import type { TunarrScheduleItem } from '@/shared/types'

export interface NowPlaying {
  current: TunarrScheduleItem
  next: TunarrScheduleItem | null
  /** 0–1 through the current programme. */
  progress: number
  /** Whole minutes left, floored, never negative. */
  minutesRemaining: number
  endsAt: number
}

/** `startTime` is epoch ms in the bulk EPG, but an ISO string is tolerated. */
function startMs(item: TunarrScheduleItem): number {
  if (typeof item.startTime === 'number') return item.startTime
  const parsed = new Date(item.startTime).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The programme covering `now`, plus whatever follows it.
 *
 * Returns null when the schedule is empty or `now` falls in a gap — an EPG that
 * has not been materialized far enough is an ordinary state, not an error.
 */
export function findNowPlaying(
  schedule: TunarrScheduleItem[] | undefined,
  now: number,
): NowPlaying | null {
  if (!schedule?.length) return null
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i]
    const start = startMs(item)
    const duration = item.duration ?? 0
    const end = start + duration
    if (now >= start && now < end) {
      return {
        current: item,
        next: schedule[i + 1] ?? null,
        progress: duration > 0 ? Math.min(1, Math.max(0, (now - start) / duration)) : 0,
        minutesRemaining: Math.max(0, Math.floor((end - now) / 60_000)),
        endsAt: end,
      }
    }
  }
  return null
}

/** "SpongeBob SquarePants — S1E1 Help Wanted", degrading as fields are missing. */
export function describeProgram(item: TunarrScheduleItem): string {
  const ep = item.episode
  if (!ep) return item.title || 'Program'
  const code =
    ep.season != null && ep.episode != null
      ? `S${ep.season}E${ep.episode}`
      : ep.episode != null
        ? `E${ep.episode}`
        : ''
  const tail = [code, ep.title].filter(Boolean).join(' ')
  return tail ? `${item.title} — ${tail}` : item.title || 'Program'
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
