/**
 * Settings → Icons: the house style used when Linearr generates a channel icon.
 *
 * Nothing here is Galaxy-specific in the code — the defaults happen to be
 * Galaxy's, and every field is editable. The live sample is the point: these
 * are typographic choices, and a list of font names tells you nothing about
 * what the result looks like.
 */
import { useEffect, useState } from 'react'
import type { IconBrandDefaults } from '@/shared/types'
import { FONTS, nearestWeight, weightsFor } from '@/features/icons/editor/fonts'
import { MAX_CANVAS, MIN_CANVAS, type Composition } from '@/features/icons/editor/types'
import { generateIconComposition } from '@/features/icons/generate'
import { compositionToPngDataUrl } from '@/features/icons/editor/render'

const inputClass =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500'
const labelClass = 'block text-xs text-slate-400 mb-1.5'

export function IconBrandPanel({
  value,
  onChange,
}: {
  value: IconBrandDefaults
  onChange: (next: IconBrandDefaults) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)

  // Same debounce-and-discard-stale shape as the generator panel: a font that
  // has not loaded yet makes the first render much slower than the rest, so an
  // earlier call can otherwise resolve last and paint over a newer preview.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void (async () => {
        try {
          const comp: Composition = await generateIconComposition(
            value.brand_line || 'Galaxy',
            'Cartoons',
            value,
          )
          const url = await compositionToPngDataUrl(comp)
          if (live) setPreview(url)
        } catch {
          if (live) setPreview(null)
        }
      })()
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [value])

  function set<K extends keyof IconBrandDefaults>(key: K, v: IconBrandDefaults[K]) {
    onChange({ ...value, [key]: v })
  }

  /**
   * Changing a font also snaps its weight onto one that family really has.
   * Baloo Thambi ships a single weight (400); leaving 500 selected would make
   * the browser synthesize a faux bold, which looks subtly wrong and is
   * impossible to diagnose from the UI.
   */
  function setFont(fontKey: 'brand_font' | 'name_font', font: string) {
    const weightKey = fontKey === 'brand_font' ? 'brand_weight' : 'name_weight'
    onChange({ ...value, [fontKey]: font, [weightKey]: nearestWeight(font, value[weightKey]) })
  }

  const brandWeights = weightsFor(value.brand_font)
  const nameWeights = weightsFor(value.name_font)
  const singleWeight = [
    brandWeights.length === 1 ? value.brand_font : null,
    nameWeights.length === 1 ? value.name_font : null,
  ].filter(Boolean) as string[]

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-200">Generated channel icons</h3>
        <p className="mt-1 text-xs text-slate-400">
          Linearr can build a channel icon from two lines of text: a brand line over the channel
          name. These are the defaults — both lines stay editable each time you generate one.
        </p>
      </div>

      <div className="flex items-start gap-4">
        <div
          className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-size-[14px_14px]"
          aria-live="polite"
        >
          {preview ? (
            <img src={preview} alt="Sample generated icon" className="max-h-full max-w-full" />
          ) : (
            <span className="text-[10px] text-slate-500">Rendering…</span>
          )}
        </div>
        <p className="pt-1 text-xs text-slate-500">
          Live sample, using your settings with the channel line “Cartoons”. Icons are generated on
          transparent backgrounds and auto-fitted to fill the canvas, leaving a 5% margin.
        </p>
      </div>

      <div>
        <label htmlFor="icon-brand-line" className={labelClass}>
          Brand line
        </label>
        <input
          id="icon-brand-line"
          type="text"
          value={value.brand_line}
          onChange={(e) => set('brand_line', e.target.value)}
          placeholder="Galaxy"
          className={inputClass}
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Prefilled as the first line. A channel already named “{value.brand_line || 'Galaxy'}{' '}
          Cartoons” is not doubled up — the brand is peeled off and the rest becomes the second
          line.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="icon-brand-font" className={labelClass}>
            Brand font
          </label>
          <select
            id="icon-brand-font"
            value={value.brand_font}
            onChange={(e) => setFont('brand_font', e.target.value)}
            className={inputClass}
          >
            {FONTS.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.weights?.length === 1 ? ' (one weight)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="icon-brand-weight" className={labelClass}>
            Brand weight
          </label>
          <select
            id="icon-brand-weight"
            value={value.brand_weight}
            onChange={(e) => set('brand_weight', Number(e.target.value))}
            disabled={brandWeights.length === 1}
            className={inputClass}
          >
            {brandWeights.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="icon-name-font" className={labelClass}>
            Channel font
          </label>
          <select
            id="icon-name-font"
            value={value.name_font}
            onChange={(e) => setFont('name_font', e.target.value)}
            className={inputClass}
          >
            {FONTS.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.weights?.length === 1 ? ' (one weight)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="icon-name-weight" className={labelClass}>
            Channel weight
          </label>
          <select
            id="icon-name-weight"
            value={value.name_weight}
            onChange={(e) => set('name_weight', Number(e.target.value))}
            disabled={nameWeights.length === 1}
            className={inputClass}
          >
            {nameWeights.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      {singleWeight.length > 0 && (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200/80">
          <strong className="text-amber-200">
            {singleWeight.join(' and ')} {singleWeight.length > 1 ? 'ship' : 'ships'} a single
            weight.
          </strong>{' '}
          The weight control is fixed for {singleWeight.length > 1 ? 'those' : 'that'} font — asking
          for another makes the browser fake it, which is how you get letterforms that look
          almost-but-not-quite right. If you want a heavier brand line, use <em>Baloo Thambi 2</em>,
          which is variable from 400 to 800 and has the same letterforms.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="icon-color" className={labelClass}>
            Text colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="icon-color"
              type="text"
              value={value.color}
              onChange={(e) => set('color', e.target.value)}
              placeholder="#ffffff"
              className={inputClass}
            />
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : '#ffffff'}
              onChange={(e) => set('color', e.target.value)}
              aria-label="Pick text colour"
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-700 bg-slate-900"
            />
          </div>
        </div>
        <div>
          <label htmlFor="icon-width" className={labelClass}>
            Canvas width
          </label>
          <input
            id="icon-width"
            type="number"
            min={MIN_CANVAS}
            max={MAX_CANVAS}
            value={value.width}
            onChange={(e) => set('width', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="icon-height" className={labelClass}>
            Canvas height
          </label>
          <input
            id="icon-height"
            type="number"
            min={MIN_CANVAS}
            max={MAX_CANVAS}
            value={value.height}
            onChange={(e) => set('height', Number(e.target.value))}
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Tunarr scales channel logos to fit, so a larger canvas mostly costs upload size. 512×512 is
        a good default; go bigger only if you also use these icons somewhere they are shown large.
      </p>
    </div>
  )
}
