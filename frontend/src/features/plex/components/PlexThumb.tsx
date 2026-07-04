import { memo } from 'react'

interface PlexThumbProps {
  path: string | null | undefined
  alt?: string
  className?: string
  onClick?: () => void
  /** Requested thumb size — the backend transcodes to this via Plex, so ask
   * for roughly 2x the rendered CSS size for retina. Defaults suit grid cells. */
  w?: number
  h?: number
}

export const PlexThumb = memo(function PlexThumb({
  path,
  alt = '',
  className = '',
  onClick,
  w = 240,
  h = 360,
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
