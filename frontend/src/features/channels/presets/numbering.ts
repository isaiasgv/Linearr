// Channel number suggestion helper.
// Tier ranges follow the convention used in main.py /api/channels/ai-suggest.

import type { Channel } from '@/shared/types'

export const TIER_RANGES: Record<Channel['tier'], [number, number]> = {
  'Galaxy Main': [100, 119],
  Classics: [120, 139],
  'Galaxy Premium': [140, 159],
}

/**
 * Returns the next available channel number within the given tier's range.
 * Falls back to (max existing + 1) if tier range is full.
 */
export function nextAvailableNumber(existing: number[], tier: Channel['tier']): number {
  const [start, end] = TIER_RANGES[tier]
  const used = new Set(existing)
  for (let n = start; n <= end; n++) {
    if (!used.has(n)) return n
  }
  // tier range full — find next free integer above the current max
  const max = existing.length > 0 ? Math.max(...existing) : end
  let candidate = max + 1
  while (used.has(candidate)) candidate++
  return candidate
}
