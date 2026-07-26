import type { Channel } from '@/shared/types'

/**
 * React key for a channel row. Use this everywhere a list of channels renders.
 *
 * `uid` is the channel's stable server-assigned identity (uuid4, additive only,
 * preserved through a renumber). NOT `ch.number`: a reorder renumbers, so a
 * number-keyed row is torn down and rebuilt when it moves, losing DOM/state
 * association (drag attributes, focus, drop highlight). NOT `tier|name` either:
 * `channels.name` has no unique constraint, so two same-named channels in one
 * tier would collide on one key and mis-associate.
 *
 * `uid` is optional on the type so a response from an older backend (or a stale
 * React Query cache entry mid-migration) still type-checks — fall back to a
 * composite that is at least unique (`number` is the primary key) rather than
 * rendering `undefined` as a key.
 */
export function channelKey(ch: Pick<Channel, 'uid' | 'number' | 'name' | 'tier'>): string {
  return ch.uid || `${ch.tier}|${ch.name}|${ch.number}`
}

/** Solid tier-colored background for channel-number chips (sidebar list, detail header). */
export function tierNumberColor(tier: Channel['tier']): string {
  switch (tier) {
    case 'Galaxy Main':
      return 'bg-blue-700 text-blue-100'
    case 'Classics':
      return 'bg-purple-700 text-purple-100'
    case 'Galaxy Premium':
      return 'bg-amber-700 text-amber-100'
  }
}
