/**
 * Live icon generator — two text lines and a preview that keeps up with typing.
 *
 * Deliberately generates nothing behind the user's back: it renders a preview,
 * and the parent decides what to do with it. The channel form uses it inline
 * (so a new channel gets an icon without a detour through the designer), and
 * the channel view uses it in a modal.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui'
import { useSettings } from '@/features/settings/hooks'
import {
  FALLBACK_BRAND_DEFAULTS,
  generateIconComposition,
  splitChannelName,
  type IconBrandDefaults,
} from '../generate'
import { compositionToPngDataUrl } from '../editor/render'
import type { Composition } from '../editor/types'

interface Props {
  /** The channel's name — seeds the second line until the user edits it. */
  channelName: string
  /** Called with a rendered PNG data URI plus the composition behind it. */
  onGenerated: (dataUrl: string, composition: Composition) => void
  /** Open the composition in the full designer instead of accepting it. */
  onEditInDesigner?: (composition: Composition) => void
  /** Rendered under the preview — e.g. a Clear button. */
  footer?: React.ReactNode
  className?: string
}

/** Rendering is a font load plus a rasterize; typing should not queue dozens. */
const DEBOUNCE_MS = 250

export function IconGeneratorPanel({
  channelName,
  onGenerated,
  onEditInDesigner,
  footer,
  className = '',
}: Props) {
  const { data: settings } = useSettings()
  const defaults: IconBrandDefaults = settings?.icon_brand_defaults ?? FALLBACK_BRAND_DEFAULTS

  const [brandLine, setBrandLine] = useState('')
  const [channelLine, setChannelLine] = useState('')
  // Once either field is edited by hand, the channel name stops driving them.
  const [touched, setTouched] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [composition, setComposition] = useState<Composition | null>(null)
  const [busy, setBusy] = useState(false)

  // Follow the channel name until the user takes over.
  useEffect(() => {
    if (touched) return
    const split = splitChannelName(channelName, defaults.brand_line)
    setBrandLine(split.brandLine)
    setChannelLine(split.channelLine)
  }, [channelName, defaults.brand_line, touched])

  // Render on a debounce. The generation counter guards against an earlier,
  // slower render (a first font load is much slower than the ones after)
  // resolving last and painting a stale preview over a newer one.
  const runId = useRef(0)
  const render = useCallback(
    async (brand: string, name: string) => {
      if (!brand.trim() && !name.trim()) {
        setPreview(null)
        setComposition(null)
        return
      }
      const id = ++runId.current
      setBusy(true)
      try {
        const comp = await generateIconComposition(brand, name, defaults)
        const dataUrl = await compositionToPngDataUrl(comp)
        if (id !== runId.current) return
        setComposition(comp)
        setPreview(dataUrl)
      } catch {
        if (id === runId.current) {
          setPreview(null)
          setComposition(null)
        }
      } finally {
        if (id === runId.current) setBusy(false)
      }
    },
    [defaults],
  )

  useEffect(() => {
    const t = setTimeout(() => void render(brandLine, channelLine), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [brandLine, channelLine, render])

  function edit(next: { brand?: string; name?: string }) {
    setTouched(true)
    if (next.brand !== undefined) setBrandLine(next.brand)
    if (next.name !== undefined) setChannelLine(next.name)
  }

  const inputClass =
    'w-full bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500'

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] tracking-wide text-slate-500 uppercase">
            Brand line
          </label>
          <input
            type="text"
            value={brandLine}
            onChange={(e) => edit({ brand: e.target.value })}
            placeholder={defaults.brand_line}
            aria-label="Icon brand line"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] tracking-wide text-slate-500 uppercase">
            Channel line
          </label>
          <input
            type="text"
            value={channelLine}
            onChange={(e) => edit({ name: e.target.value })}
            placeholder="Cartoons"
            aria-label="Icon channel line"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Checkerboard, because the icons are transparent and white text on a
            dark panel is indistinguishable from white text on nothing. */}
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-size-[12px_12px]"
          aria-live="polite"
        >
          {preview ? (
            <img src={preview} alt="Generated icon preview" className="max-h-full max-w-full" />
          ) : (
            <span className="px-2 text-center text-[10px] text-slate-500">
              {busy ? 'Rendering…' : 'Type a line'}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <Button
            size="sm"
            disabled={!preview || busy}
            onClick={() => preview && composition && onGenerated(preview, composition)}
          >
            Use this icon
          </Button>
          {onEditInDesigner && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!composition || busy}
              onClick={() => composition && onEditInDesigner(composition)}
            >
              Edit in designer
            </Button>
          )}
          {footer}
          <p className="w-full text-[11px] text-slate-500">
            {defaults.brand_font} {defaults.brand_weight} over {defaults.name_font}{' '}
            {defaults.name_weight}, {defaults.width}×{defaults.height}. Change the house style in
            Settings → Icons.
          </p>
        </div>
      </div>
    </div>
  )
}
