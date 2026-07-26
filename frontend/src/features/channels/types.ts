import type { Channel } from '@/shared/types'

export type { Channel } from '@/shared/types'

export interface ChannelFormData {
  number: string
  name: string
  tier: string
  vibe: string
  mode: string
  style: string
  color: string
}

// ── Reorder / renumber ────────────────────────────────────────────────────────
//
// `channels.number` is the PRIMARY KEY, so a reorder is a *renumber*. These
// types mirror the response of `POST /api/channels/reorder` exactly — see the
// `reorder_channels` route in `main.py`.

/** One channel whose number and/or tier changed as part of a reorder. */
export interface ChannelReorderChange {
  old_number: number
  new_number: number
  tier: string
}

/**
 * A single channel that could not be propagated to Tunarr. The local reorder
 * still committed — never report these as "the reorder failed".
 *
 * `state`:
 * - `unchanged` — Tunarr still holds the channel's old number. Harmless.
 * - `parked` — the Tunarr channel is **stranded on a temporary number**
 *   (`parked_number`). User-visible breakage until someone fixes it, so it must
 *   be surfaced distinctly, not folded into a generic error.
 */
export interface ChannelReorderTunarrFailure {
  number: number
  message: string
  state: 'unchanged' | 'parked'
  parked_number?: number
}

export interface ChannelReorderRequest {
  moved_number: number
  /** 0-based index the moved channel should occupy in the **resulting** lineup. */
  target_index: number
  /** Destination tier for a cross-tier move; `null` keeps the channel's tier. */
  target_tier?: string | null
}

export interface ChannelReorderResult {
  changed: ChannelReorderChange[]
  /** The authoritative new lineup — replace the `['channels']` cache with it. */
  channels: Channel[]
  tunarr: { synced: number; failed: ChannelReorderTunarrFailure[] }
}
