// Drop-index math + a client-side mirror of the backend renumber computation.
//
// Pure functions only — no React, no I/O. The backend (`_compute_reorder` in
// `main.py`) is authoritative; `computeReorder` here exists solely so a
// cross-tier drop can show the user the exact number changes *before* they are
// committed. It is a faithful port of the Python, so if you touch one, touch
// both.

import type { Channel } from '@/shared/types'
import { TIER_RANGES } from './presets/numbering'
import type { ChannelReorderChange } from './types'

interface LineupRow {
  number: number
  tier: string
}

/** The lineup in the same order the API returns it — ascending by number. */
export function sortedLineup<T extends { number: number }>(channels: readonly T[]): T[] {
  return [...channels].sort((a, b) => a.number - b.number)
}

/**
 * The `target_index` to POST when `movedNumber` is dropped onto the row
 * currently occupied by `overNumber`.
 *
 * The endpoint's `target_index` is the **post-drop** index — the index the
 * moved channel occupies in the *resulting* lineup. The rule turns out to be
 * simply "the pre-drop index of the row you dropped on", and it holds in both
 * drag directions. Derivation, with the pre-drop lineup `full` (sorted by
 * number), `src = full.indexOf(moved)`, `over = full.indexOf(target)`, and
 * `others = full` minus `moved` (which is what the backend inserts into):
 *
 * - **Dragging down** (`src < over`): removing `moved` shifts the target left,
 *   so `others.indexOf(target) === over - 1`. Inserting `moved` at `over`
 *   yields `[…, target@over-1, moved@over, …]` — `moved` lands on exactly the
 *   index the target held, and the target slides up one. Post-drop index of
 *   `moved` = `over`.
 * - **Dragging up** (`src > over`): removing `moved` does not disturb indices
 *   below `src`, so `others.indexOf(target) === over`. Inserting `moved` at
 *   `over` yields `[…, moved@over, target@over+1, …]` — again `moved` lands on
 *   the target's old index and the target slides down one. Post-drop index =
 *   `over`.
 *
 * So a single expression covers both, and the four boundary cases fall out:
 * first→last gives `over = len-1` (`moved` ends last), last→first gives
 * `over = 0` (`moved` ends first), and a one-row nudge in either direction
 * swaps exactly the two rows.
 *
 * Indices are always computed against the **full** lineup, never the filtered
 * sidebar view, because the endpoint indexes the full lineup.
 *
 * Returns -1 if `overNumber` is not in the lineup.
 */
export function channelDropTargetIndex(channels: readonly Channel[], overNumber: number): number {
  return sortedLineup(channels).findIndex((c) => c.number === overNumber)
}

/**
 * Port of `_compute_reorder` (`main.py`). Returns only the channels whose
 * number or tier actually changes; `[]` for a no-op.
 *
 * Same tier (or a destination tier with no canonical range): rotate the numbers
 * already held by the source..destination window, so relative gaps survive and
 * nothing outside the window moves. Cross tier into a known range: take the
 * slot after the last destination-tier channel that ends up ahead, then bump
 * the contiguous run starting there so the new number is free.
 */
export function computeReorder(
  channels: readonly { number: number; tier: string }[],
  movedNumber: number,
  targetIndex: number,
  targetTier: string | null = null,
): ChannelReorderChange[] {
  const lineup: LineupRow[] = sortedLineup(channels).map((c) => ({
    number: c.number,
    tier: c.tier ?? '',
  }))
  const srcIndex = lineup.findIndex((c) => c.number === movedNumber)
  if (srcIndex === -1) return []

  const moved = lineup[srcIndex]
  const others = lineup.filter((c) => c.number !== movedNumber)
  const dst = Math.max(0, Math.min(targetIndex, others.length))
  const newTier = targetTier ?? moved.tier
  const crossTier = newTier !== moved.tier
  const destRange = crossTier ? TIER_RANGES[newTier as Channel['tier']] : undefined

  if (!destRange) {
    if (dst === srcIndex && !crossTier) return []
    // Rotate the window's numbers onto the reordered channels.
    const newOrder = [...others.slice(0, dst), moved, ...others.slice(dst)]
    const lo = Math.min(srcIndex, dst)
    const hi = Math.max(srcIndex, dst)
    const numbers = lineup.slice(lo, hi + 1).map((c) => c.number)
    const changes: ChannelReorderChange[] = []
    newOrder.slice(lo, hi + 1).forEach((ch, offset) => {
      const tier = ch === moved ? newTier : ch.tier
      const number = numbers[offset]
      if (number !== ch.number || tier !== ch.tier) {
        changes.push({ old_number: ch.number, new_number: number, tier })
      }
    })
    return changes
  }

  // Cross-tier into a tier with a canonical range.
  const [low] = destRange
  const ahead = others.slice(0, dst).filter((c) => c.tier === newTier)
  const desired = ahead.length > 0 ? Math.max(low, ahead[ahead.length - 1].number + 1) : low

  const changes: ChannelReorderChange[] = [
    { old_number: moved.number, new_number: desired, tier: newTier },
  ]
  // Only an exact hit on `desired` collides; the bump then walks the contiguous
  // run until a gap absorbs it.
  let prevNew = desired
  for (const ch of others.filter((c) => c.number >= desired)) {
    if (ch.number > prevNew) break
    prevNew = ch.number + 1
    changes.push({ old_number: ch.number, new_number: prevNew, tier: ch.tier })
  }
  return changes
}

/** "104 → 120, 120 → 121, 121 → 122" — for the cross-tier confirm dialog. */
export function describeReorderChanges(
  changes: readonly ChannelReorderChange[],
  limit = 10,
): string {
  const shown = changes.slice(0, limit).map((c) => `${c.old_number} → ${c.new_number}`)
  const rest = changes.length - shown.length
  return rest > 0 ? `${shown.join(', ')} … and ${rest} more` : shown.join(', ')
}

/**
 * The subset of a reorder preview that touches channels the caller is NOT
 * currently showing.
 *
 * The renumber window spans every channel between the source and the
 * destination in the FULL lineup, so a drag inside one tier still renumbers any
 * other-tier channel that happens to sit numerically between the two endpoints —
 * rows a tier filter has hidden. Those are exactly the changes a user cannot
 * see, so they are the ones worth confirming.
 */
export function hiddenReorderChanges(
  changes: readonly ChannelReorderChange[],
  visibleChannels: readonly { number: number }[],
): ChannelReorderChange[] {
  const visible = new Set(visibleChannels.map((c) => c.number))
  return changes.filter((c) => !visible.has(c.old_number))
}

/** "104 Boomerang → 105, 106 TCM → 107" — names the rows the user cannot see. */
export function describeNamedReorderChanges(
  changes: readonly ChannelReorderChange[],
  channels: readonly { number: number; name: string }[],
  limit = 8,
): string {
  const nameOf = new Map(channels.map((c) => [c.number, c.name]))
  const shown = changes.slice(0, limit).map((c) => {
    const name = nameOf.get(c.old_number)
    return `${c.old_number}${name ? ` ${name}` : ''} → ${c.new_number}`
  })
  const rest = changes.length - shown.length
  return rest > 0 ? `${shown.join(', ')} … and ${rest} more` : shown.join(', ')
}
