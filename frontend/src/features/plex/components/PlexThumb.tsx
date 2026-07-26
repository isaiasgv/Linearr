import { memo } from 'react'
import { THUMB_POSTER } from '../thumbSizes'

interface PlexThumbProps {
  path: string | null | undefined
  alt?: string
  className?: string
  onClick?: () => void
  /** Requested thumb size — the backend transcodes to this via Plex. Pass one of
   * the canonical sizes from `../thumbSizes` (`THUMB_POSTER` / `THUMB_DENSE`),
   * never a bespoke per-call-site dimension: every distinct pair is a separate
   * key in all three cache layers. Defaults to `THUMB_POSTER`. */
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
