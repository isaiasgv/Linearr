import type { CSSProperties } from 'react'
import type { Watermark } from '../types'

interface WatermarkPreviewProps {
  watermark: Watermark
  imageUrl?: string | null
}

/**
 * Live model of Tunarr's ffmpeg overlay filter chain.
 *
 * The frame is 16:9 (Tunarr's output aspect), `width` is a percentage of the
 * output frame width, the margins are percentages measured from the chosen
 * corner (vertical against frame height, horizontal against frame width —
 * which is exactly how a CSS `top`/`left` percentage resolves), and
 * `fixed_size` skips the scale filter entirely so `width` stops applying.
 */
/**
 * Browser-safe src for a stored watermark image URL.
 *
 * `watermark_image_url` is an absolute URL on the *Tunarr* base — on a default
 * Docker deployment `http://tunarr:8000/images/uploads/...` — because ffmpeg
 * inside the Tunarr container is what fetches it. This browser is on the LAN and
 * cannot resolve that container hostname, so rendering the stored value directly
 * always yields a broken image. Tunarr-hosted uploads therefore go through the
 * same-origin `/api/tunarr/image` proxy, which fetches server-side.
 *
 * A URL outside Tunarr's `/images/` directory is something the user pasted from
 * elsewhere (a CDN, say). The browser can fetch that itself, and the proxy
 * deliberately refuses it, so it is used as-is.
 */
export function watermarkPreviewSrc(imageUrl: string): string {
  try {
    const { pathname } = new URL(imageUrl, window.location.origin)
    return pathname.startsWith('/images/')
      ? `/api/tunarr/image?path=${encodeURIComponent(pathname)}`
      : imageUrl
  } catch {
    return imageUrl
  }
}

export function WatermarkPreview({ watermark, imageUrl }: WatermarkPreviewProps) {
  const { position, width, vertical_margin, horizontal_margin, opacity, fixed_size, enabled } =
    watermark
  const previewSrc = imageUrl ? watermarkPreviewSrc(imageUrl) : null

  const isTop = position.startsWith('top')
  const isLeft = position.endsWith('left')

  const placement: CSSProperties = {
    position: 'absolute',
    top: isTop ? `${vertical_margin}%` : undefined,
    bottom: isTop ? undefined : `${vertical_margin}%`,
    left: isLeft ? `${horizontal_margin}%` : undefined,
    right: isLeft ? undefined : `${horizontal_margin}%`,
    // fixedSize means Tunarr never runs the scale filter, so the image lands at
    // its own pixel size — there is no width to model.
    width: fixed_size ? undefined : `${Math.max(width, 0)}%`,
    opacity: Math.min(Math.max(opacity, 0), 100) / 100,
  }

  return (
    <div>
      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
        style={{ aspectRatio: '16 / 9' }}
      >
        {/* Stand-in for video content so placement and opacity stay legible */}
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-br from-slate-700 via-slate-900 to-black"
        />
        <div
          aria-hidden
          className="absolute inset-0 grid place-items-center text-[10px] font-medium tracking-[0.2em] text-slate-600 uppercase"
        >
          Program video
        </div>

        {!enabled ? (
          <p className="absolute inset-0 grid place-items-center bg-slate-950/70 text-xs text-slate-400">
            Watermark disabled
          </p>
        ) : previewSrc ? (
          <img
            src={previewSrc}
            alt="Watermark preview"
            style={placement}
            className={fixed_size ? 'max-w-[40%]' : undefined}
          />
        ) : (
          <div
            style={placement}
            className={`grid aspect-square place-items-center rounded-sm border border-indigo-400/40 bg-indigo-500/40 text-[9px] font-semibold tracking-wider text-indigo-50 uppercase ${
              fixed_size ? 'h-10 w-10' : ''
            }`}
          >
            Logo
          </div>
        )}
      </div>

      <p className="mt-1.5 text-xs text-slate-500">
        {fixed_size
          ? 'Fixed size — Tunarr skips scaling, so the width setting has no effect.'
          : `Scaled to ${width}% of the frame width`}
        {' · '}
        {position.replace('-', ' ')} corner, {vertical_margin}% / {horizontal_margin}% margins,{' '}
        {opacity}% opacity
      </p>
      {!imageUrl && (
        <p className="mt-1 text-xs text-amber-400/80">
          No image resolved yet — the placeholder above stands in for one. Apply an image below or
          Tunarr will have nothing to draw.
        </p>
      )}
    </div>
  )
}
