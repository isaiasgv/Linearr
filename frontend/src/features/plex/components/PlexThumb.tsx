import { memo } from 'react'

interface PlexThumbProps {
  path: string | null | undefined
  alt?: string
  className?: string
  onClick?: () => void
}

export const PlexThumb = memo(function PlexThumb({
  path,
  alt = '',
  className = '',
  onClick,
}: PlexThumbProps) {
  if (!path) return null

  const src = `/api/plex/thumb?path=${encodeURIComponent(path)}`

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onClick={onClick}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
})
