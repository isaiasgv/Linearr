interface PlexThumbProps {
  path: string | null | undefined
  alt?: string
  className?: string
}

export function PlexThumb({ path, alt = '', className = '' }: PlexThumbProps) {
  if (!path) return null

  const src = `/api/plex/thumb?path=${encodeURIComponent(path)}`

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={(e) => {
        const target = e.currentTarget
        target.style.display = 'none'
      }}
    />
  )
}
