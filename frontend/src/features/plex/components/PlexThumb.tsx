import { memo } from 'react'

export interface ThumbSize {
  readonly w: number
  readonly h: number
}

/**
 * Poster grids and detail art — the DEFAULT, and the size the backend itself
 * defaults to. Every full-size poster surface in the app requests this, so a
 * poster fetched anywhere is already warm in all three cache layers (the
 * backend LRU keyed on `(path, w, h)`, the service worker's `linearr-thumbs`
 * cache, and the browser cache) for every other one.
 */
export const THUMB_POSTER: ThumbSize = { w: 240, h: 360 }

/**
 * Dense rows, strips and collages — anything rendering at roughly 60 CSS px
 * wide or less, where 240x360 is wasteful.
 *
 * There are deliberately only TWO canonical sizes. A bespoke size per rendered
 * dimension forks the cache: each variant is its own key in all three layers,
 * so switching a size control re-downloads the whole visible grid and a large
 * library across several variants overflows the 1500-entry backend LRU. Ask for
 * the nearest canonical size (over-fetching slightly is fine — these are
 * 10-30 KB transcodes) rather than adding a third. See the performance
 * invariants in CLAUDE.md.
 */
export const THUMB_DENSE: ThumbSize = { w: 120, h: 180 }

interface PlexThumbProps {
  path: string | null | undefined
  alt?: string
  className?: string
  onClick?: () => void
  /** Requested thumb size — the backend transcodes to this via Plex. Pass one of
   * the canonical sizes ({@link THUMB_POSTER} / {@link THUMB_DENSE}), never a
   * bespoke per-call-site dimension. Defaults to {@link THUMB_POSTER}. */
  w?: number
  h?: number
}

export const PlexThumb = memo(function PlexThumb({
  path,
  alt = '',
  className = '',
  onClick,
  w = THUMB_POSTER.w,
  h = THUMB_POSTER.h,
}: PlexThumbProps) {
  if (!path) return null

  const src = `/api/plex/thumb?path=${encodeURIComponent(path)}&w=${w}&h=${h}`

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      // Dark placeholder while the image streams in — avoids white pop-in.
      className={`bg-slate-800 ${className}`}
      onClick={onClick}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
})
