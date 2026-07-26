import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Field, IconButton, Input, ModalWrapper, Select } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { useDeleteWatermark, useSaveWatermark, useSetWatermarkImage, useWatermark } from '../hooks'
import {
  DEFAULT_FADE,
  DEFAULT_WATERMARK,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  type Watermark,
} from '../types'
import { WatermarkPreview } from './WatermarkPreview'

const TITLE_ID = 'watermark-editor-title'
const ENABLE_HINT_ID = 'watermark-enable-hint'

const NEEDS_IMAGE_MSG =
  'Apply a watermark image first — Tunarr needs an absolute image URL to draw.'

/** Client-side mirror of the backend's Tunarr-derived constraints. */
function validate(
  form: Watermark,
  fadeOn: boolean,
  hasImage: boolean,
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  // Mirrors the backend gate on PUT .../watermark. An enabled watermark with no
  // resolved image maps to `url: ""`, and because every channel write is a full
  // SaveableChannel PUT, Tunarr rejecting it would break EVERY later save for
  // this channel — name, number and tier included. The user must never reach
  // that 400, so the state is not submittable here either.
  if (form.enabled && !hasImage) errors.enabled = NEEDS_IMAGE_MSG
  if (!(form.width > 0)) errors.width = 'Must be greater than 0.'
  if (form.vertical_margin < 0 || form.vertical_margin > 100)
    errors.vertical_margin = 'Must be between 0 and 100.'
  if (form.horizontal_margin < 0 || form.horizontal_margin > 100)
    errors.horizontal_margin = 'Must be between 0 and 100.'
  if (!Number.isInteger(form.opacity) || form.opacity < 0 || form.opacity > 100)
    errors.opacity = 'Must be a whole number between 0 and 100.'
  if (!(form.duration >= 0)) errors.duration = 'Cannot be negative.'
  if (fadeOn && !((form.fade?.period_mins ?? 0) >= 1))
    errors.fade = 'Fade period must be at least 1 minute.'
  return errors
}

export function WatermarkEditorModal() {
  const open = useUIStore((s) => s.modals.watermarkEditor)
  const closeModal = useUIStore((s) => s.closeModal)
  const channel = useUIStore((s) => s.selectedChannel)

  // Zero while closed keeps the query disabled, so selecting channels around
  // the app does not fire a watermark GET for each one.
  const channelNumber = open ? (channel?.number ?? 0) : 0

  const { data, isLoading } = useWatermark(channelNumber)
  const save = useSaveWatermark(channelNumber)
  const remove = useDeleteWatermark(channelNumber)
  const setImage = useSetWatermarkImage(channelNumber)

  const [form, setForm] = useState<Watermark>(DEFAULT_WATERMARK)
  const [fadeOn, setFadeOn] = useState(false)
  // Transient: the resolved absolute URL is owned by the backend
  // (watermark_image_url), so this input is only what to send next.
  const [urlInput, setUrlInput] = useState('')

  const stored = data?.watermark ?? null
  // Top-level `image_url` first: an image applied before any config was saved
  // exists with `watermark: null`, so reading it only off `stored` would hide it.
  const imageUrl = data?.image_url ?? stored?.image_url ?? null
  // Server-owned: only "Apply image" resolves one, and it saves immediately.
  const hasImage = Boolean(imageUrl && imageUrl.trim())

  // Hydrate exactly once per open, as soon as the stored config has settled.
  // Re-hydrating on every `stored` change would wipe unsaved edits whenever an
  // image apply invalidates the query while the modal is still open.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!open) {
      hydrated.current = false
      return
    }
    if (isLoading || hydrated.current) return
    hydrated.current = true
    setForm(stored ? { ...DEFAULT_WATERMARK, ...stored } : DEFAULT_WATERMARK)
    setFadeOn(Boolean(stored?.fade))
    setUrlInput(imageUrl ?? '')
  }, [open, isLoading, stored, imageUrl])

  const errors = useMemo(() => validate(form, fadeOn, hasImage), [form, fadeOn, hasImage])
  const hasErrors = Object.keys(errors).length > 0

  function set<K extends keyof Watermark>(key: K, value: Watermark[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function close() {
    closeModal('watermarkEditor')
  }

  function handleSave() {
    if (hasErrors) return
    save.mutate(
      { ...form, fade: fadeOn ? (form.fade ?? DEFAULT_FADE) : null },
      { onSuccess: close },
    )
  }

  function handleApplyImage() {
    setImage.mutate(form.use_channel_icon ? {} : { url: urlInput.trim() })
  }

  const checkbox = 'h-4 w-4 accent-indigo-500'
  const checkboxLabel = 'flex items-center gap-2 text-sm text-slate-300'

  return (
    <ModalWrapper open={open} onClose={close} maxWidth="max-w-4xl" titleId={TITLE_ID}>
      <div className="flex max-h-[85vh] flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="text-base font-semibold text-slate-100">
              Channel Watermark
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {channel ? `Channel ${channel.number} — ${channel.name}` : 'No channel selected'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Enabling with no resolved image is not submittable (see validate),
                so the tick itself is blocked until an image is applied. Unticking
                stays available even in that state, so a stored config that somehow
                lost its image can still be switched off. */}
            <div className="flex flex-col items-end">
              <label
                className={`${checkboxLabel} ${!hasImage && !form.enabled ? 'text-slate-500' : ''}`}
                title={!hasImage && !form.enabled ? NEEDS_IMAGE_MSG : undefined}
              >
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={!hasImage && !form.enabled}
                  aria-describedby={hasImage ? undefined : ENABLE_HINT_ID}
                  onChange={(e) => set('enabled', e.target.checked)}
                  className={`${checkbox} disabled:cursor-not-allowed disabled:opacity-50`}
                />
                Enabled
              </label>
              {!hasImage && (
                <p
                  id={ENABLE_HINT_ID}
                  className="mt-0.5 max-w-56 text-right text-[11px] text-amber-300/90"
                >
                  {errors.enabled ?? 'Apply an image below to enable this watermark.'}
                </p>
              )}
            </div>
            <IconButton label="Close" onClick={close}>
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </IconButton>
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-2">
          {/* Controls */}
          <div className="space-y-4">
            <fieldset className="space-y-2 rounded-lg border border-slate-700 p-3">
              <legend className="px-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Image
              </legend>
              <label className={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.use_channel_icon}
                  onChange={(e) => set('use_channel_icon', e.target.checked)}
                  className={checkbox}
                />
                Use this channel&rsquo;s icon
              </label>
              {!form.use_channel_icon && (
                <Input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  aria-label="Watermark image URL"
                />
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={setImage.isPending}
                disabled={!form.use_channel_icon && !urlInput.trim()}
                onClick={handleApplyImage}
              >
                {form.use_channel_icon ? 'Upload channel icon to Tunarr' : 'Use this URL'}
              </Button>
              <p className="text-xs text-slate-500">
                Tunarr fetches the image over HTTP as an ffmpeg input, so it must be hosted at an
                absolute URL — the channel icon is copied to Tunarr for you. Applying an image saves
                immediately, separately from the settings below.
              </p>
              {imageUrl && (
                <p className="truncate font-mono text-[11px] text-emerald-400/80" title={imageUrl}>
                  {imageUrl}
                </p>
              )}
            </fieldset>

            <Field label="Position" hint="Tunarr supports these four corners only.">
              <Select
                value={form.position}
                onChange={(e) => set('position', e.target.value as Watermark['position'])}
              >
                {WATERMARK_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {WATERMARK_POSITION_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Width (% of frame width)"
              hint={
                form.fixed_size
                  ? 'Disabled — fixed size skips scaling entirely.'
                  : 'Percent of the output frame width. Must be greater than 0.'
              }
              error={form.fixed_size ? undefined : errors.width}
            >
              <Input
                type="number"
                min={0.1}
                step={0.5}
                value={form.width}
                disabled={form.fixed_size}
                invalid={!form.fixed_size && Boolean(errors.width)}
                onChange={(e) => set('width', Number(e.target.value))}
              />
            </Field>

            <label className={checkboxLabel}>
              <input
                type="checkbox"
                checked={form.fixed_size}
                onChange={(e) => set('fixed_size', e.target.checked)}
                className={checkbox}
              />
              Fixed size (use the image&rsquo;s own pixel size, no scaling)
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Vertical margin (%)"
                hint="From the chosen corner."
                error={errors.vertical_margin}
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.vertical_margin}
                  invalid={Boolean(errors.vertical_margin)}
                  onChange={(e) => set('vertical_margin', Number(e.target.value))}
                />
              </Field>
              <Field
                label="Horizontal margin (%)"
                hint="From the chosen corner."
                error={errors.horizontal_margin}
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.horizontal_margin}
                  invalid={Boolean(errors.horizontal_margin)}
                  onChange={(e) => set('horizontal_margin', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Opacity (%)" hint="Whole numbers, 0–100." error={errors.opacity}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={form.opacity}
                  invalid={Boolean(errors.opacity)}
                  onChange={(e) => set('opacity', Math.round(Number(e.target.value)))}
                />
              </Field>
              <Field
                label="Duration (seconds)"
                hint="Per program segment. 0 = always on."
                error={errors.duration}
              >
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.duration}
                  invalid={Boolean(errors.duration)}
                  onChange={(e) => set('duration', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 p-3">
              <label className={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={fadeOn}
                  onChange={(e) => {
                    setFadeOn(e.target.checked)
                    if (e.target.checked && !form.fade) set('fade', DEFAULT_FADE)
                  }}
                  className={checkbox}
                />
                Intermittent fade
              </label>
              {fadeOn && (
                <>
                  <Field
                    label="Period (minutes)"
                    hint="Shown for this long, then hidden for the same."
                    error={errors.fade}
                  >
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={form.fade?.period_mins ?? DEFAULT_FADE.period_mins}
                      invalid={Boolean(errors.fade)}
                      onChange={(e) =>
                        set('fade', {
                          period_mins: Math.round(Number(e.target.value)),
                          leading_edge: form.fade?.leading_edge ?? DEFAULT_FADE.leading_edge,
                        })
                      }
                    />
                  </Field>
                  <label className={checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={form.fade?.leading_edge ?? DEFAULT_FADE.leading_edge}
                      onChange={(e) =>
                        set('fade', {
                          period_mins: form.fade?.period_mins ?? DEFAULT_FADE.period_mins,
                          leading_edge: e.target.checked,
                        })
                      }
                      className={checkbox}
                    />
                    Visible immediately at the start of a program
                  </label>
                  <p className="text-xs text-slate-500">
                    Tunarr applies only one fade rule per channel.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Preview + caveats */}
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Preview</p>
            <WatermarkPreview watermark={form} imageUrl={imageUrl} />
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200/80">
              <p className="font-semibold text-amber-200">If nothing shows up on the stream</p>
              <p className="mt-1">
                A watermark never renders when the channel&rsquo;s transcode config has
                &ldquo;disable channel overlay&rdquo; set, and it is hidden during filler when the
                channel disables the filler overlay. Those are the two reasons a correct config
                still draws nothing.
              </p>
            </div>
            {isLoading && <p className="text-xs text-slate-500">Loading saved watermark…</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-700 px-5 py-4">
          <Button
            variant="dangerSoft"
            size="sm"
            loading={remove.isPending}
            disabled={!stored}
            onClick={() => remove.mutate(undefined, { onSuccess: close })}
          >
            Clear watermark
          </Button>
          <div className="flex items-center gap-2">
            {errors.enabled && (
              <p className="max-w-72 text-right text-[11px] text-amber-300/90">{errors.enabled}</p>
            )}
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={save.isPending}
              disabled={hasErrors || !channelNumber}
              title={errors.enabled}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
