/**
 * Per-channel Tunarr watermark config.
 *
 * Field names are snake_case because they round-trip verbatim through the
 * backend's `WatermarkIn` model and are stored as a JSON blob on `channels`.
 * The backend maps them to Tunarr's camelCase `WatermarkSchema` on sync.
 */

/** Tunarr's four watermark corners — it supports no other placement. */
export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]

export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
}

export interface WatermarkFade {
  /** Minutes on, then the same off. Tunarr requires >= 1. */
  period_mins: number
  /** Visible immediately at segment start when true. */
  leading_edge: boolean
}

export interface Watermark {
  enabled: boolean
  position: WatermarkPosition
  /** Percent of the output frame width. Tunarr requires strictly > 0. */
  width: number
  /** Percent offset from the chosen corner, 0-100. */
  vertical_margin: number
  /** Percent offset from the chosen corner, 0-100. */
  horizontal_margin: number
  /** Seconds per program segment; 0 means always on. */
  duration: number
  /** Integer 0-100. */
  opacity: number
  /** When true Tunarr skips scaling entirely and `width` has no effect. */
  fixed_size: boolean
  /** Upload the channel's icon as the watermark image rather than a pasted URL. */
  use_channel_icon: boolean
  /** Tunarr applies at most one fade rule, so this is a single config, not a list. */
  fade: WatermarkFade | null
  /** Server-owned: the absolute URL Tunarr fetches. Never sent on a save. */
  image_url?: string | null
}

/** The config half of {@link Watermark} — exactly what `PUT .../watermark` takes. */
export type WatermarkConfig = Omit<Watermark, 'image_url'>

/**
 * Defaults for a NEW watermark — a discreet corner bug: 7% of frame width, 5%
 * margins, 30% opacity. Mirrors `_WATERMARK_DEFAULTS` in `main.py` and the
 * `set_channel_watermark` MCP tool; all three must agree. A channel with a
 * watermark already saved keeps its stored values.
 *
 * `use_channel_icon` defaults on because an enabled watermark MUST resolve to a
 * real image — Tunarr does not fall back to the channel logo, it feeds the URL
 * to ffmpeg as an input and a missing one takes the channel off the air. The
 * backend uploads the icon to cover that; see the note on `image_url`.
 */
export const DEFAULT_WATERMARK: Watermark = {
  enabled: false,
  position: 'bottom-right',
  width: 7,
  vertical_margin: 5,
  horizontal_margin: 5,
  duration: 0,
  opacity: 30,
  fixed_size: false,
  use_channel_icon: true,
  fade: null,
}

export const DEFAULT_FADE: WatermarkFade = { period_mins: 5, leading_edge: true }
