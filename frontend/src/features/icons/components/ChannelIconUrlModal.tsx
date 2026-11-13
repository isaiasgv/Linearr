/**
 * The URL Tunarr publishes for a channel's icon.
 *
 * Deliberately the same three sources as the watermark's image picker, because
 * they are the same problem: Tunarr copies the value into its guide, Plex
 * clients fetch it over HTTP, and only the user knows which host those clients
 * can reach.
 *
 * Before this existed the only way to get a chosen domain onto a channel logo
 * was via the watermark editor — upload the icon, apply it as a watermark, copy
 * the URL that came back, then paste it into the URL field. The watermark now
 * reuses the icon's URL, so setting it here is enough for both.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconButton, Input, ModalWrapper } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useSettings } from '@/features/settings/hooks'
import { useToastStore } from '@/shared/store/toast.store'
import { useChannelIcon, useSetChannelIconImage } from '../hooks'

const TITLE_ID = 'channel-icon-url-title'

type Source = 'derive' | 'upload' | 'url'

const SOURCE_LABELS: Record<Source, string> = {
  derive: 'From the channel icon',
  upload: 'Upload a file',
  url: 'Image URL',
}

/** Raster only — Tunarr's guide consumers are not reliable SVG renderers. */
const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export function ChannelIconUrlModal() {
  const open = useUIStore((s) => s.modals.channelIconUrl)
  const closeModal = useUIStore((s) => s.closeModal)
  const snapshot = useUIStore((s) => s.selectedChannel)
  const { data: channels } = useChannels()
  const { data: settings } = useSettings()
  const addToast = useToastStore((s) => s.addToast)

  const channel = channels?.find((c) => c.number === snapshot?.number) ?? snapshot
  const channelNumber = open ? (channel?.number ?? 0) : 0

  const { data, isLoading } = useChannelIcon(channelNumber)
  const setImage = useSetChannelIconImage(channelNumber)

  const [source, setSource] = useState<Source>('derive')
  const [urlInput, setUrlInput] = useState('')
  const [upload, setUpload] = useState<{ dataUrl: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Hydrate once per open, once the fetch has settled — re-hydrating on every
  // data change would wipe a half-typed URL when the query refetches.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!open) {
      hydrated.current = false
      return
    }
    if (isLoading || hydrated.current) return
    hydrated.current = true
    setUrlInput(data?.icon_url ?? '')
    setUpload(null)
    setSource(data?.manual ? 'url' : 'derive')
  }, [open, isLoading, data])

  function close() {
    closeModal('channelIconUrl')
  }

  function handleFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setUpload({ dataUrl: reader.result as string, name: file.name })
    reader.readAsDataURL(file)
  }

  function apply() {
    if (source === 'derive') setImage.mutate({})
    else if (source === 'upload' && upload) setImage.mutate({ image: upload.dataUrl })
    else if (source === 'url') setImage.mutate({ url: urlInput.trim() })
  }

  const applyDisabled =
    !channelNumber || (source === 'upload' && !upload) || (source === 'url' && !urlInput.trim())

  const current = data?.icon_url ?? null

  return (
    <ModalWrapper open={open} onClose={close} maxWidth="max-w-2xl" titleId={TITLE_ID}>
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="text-base font-semibold text-slate-100">
              Channel Icon URL
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {channel ? `Channel ${channel.number} — ${channel.name}` : 'No channel selected'}
            </p>
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

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex items-start gap-3">
            {data?.icon ? (
              <img
                src={data.icon}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg border border-slate-700 bg-slate-900 object-contain"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-[10px] text-slate-500">
                No icon
              </div>
            )}
            <p className="text-xs leading-relaxed text-slate-400">
              Tunarr publishes this URL in its guide, and your{' '}
              <strong className="text-slate-300">Plex clients fetch it directly</strong> — so it has
              to be an address they can reach. A LAN hostname works only on the local network.
            </p>
          </div>

          {/* Current value, copyable — the thing that previously had to be
              extracted via the watermark editor. */}
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] tracking-wide text-slate-500 uppercase">
                Current URL{data?.manual ? ' — set by hand' : ' — derived from the icon'}
              </p>
              {current && (
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(current)
                    addToast('URL copied')
                  }}
                  className="rounded-sm px-1.5 py-0.5 text-[11px] text-indigo-400 transition-colors hover:bg-slate-800 hover:text-indigo-300"
                >
                  Copy
                </button>
              )}
            </div>
            <p
              className={`mt-1 font-mono text-[11px] break-all ${current ? 'text-emerald-400/80' : 'text-slate-500'}`}
            >
              {isLoading ? 'Loading…' : (current ?? 'Not uploaded yet')}
            </p>
          </div>

          <div className="flex flex-wrap gap-1">
            {(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                aria-pressed={source === s}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  source === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>

          {source === 'derive' && (
            <p className="text-xs text-slate-500">
              Uploads the channel&rsquo;s own icon to Tunarr and uses the URL that comes back.
              {settings?.tunarr_public_url
                ? ` It will be built on ${settings.tunarr_public_url}.`
                : ' Set a Public Tunarr URL in Settings → Tunarr to control the domain for every channel at once.'}
            </p>
          )}

          {source === 'upload' && (
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              {upload && (
                <img
                  src={upload.dataUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-md border border-slate-700 bg-slate-900 object-contain"
                />
              )}
              <div className="min-w-0 flex-1">
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                  {upload ? 'Choose a different file' : 'Choose a file…'}
                </Button>
                {upload && (
                  <p className="mt-1 truncate text-[11px] text-slate-500" title={upload.name}>
                    {upload.name}
                  </p>
                )}
              </div>
            </div>
          )}

          {source === 'url' && (
            <div className="space-y-1.5">
              <Input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://tunarr.example.com/images/uploads/logo.png"
                aria-label="Channel icon URL"
              />
              <p className="text-xs text-slate-500">
                Stored exactly as typed and never re-derived — changing the channel icon later will
                not overwrite it.
              </p>
            </div>
          )}

          <p className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-xs leading-relaxed text-slate-400">
            A watermark set to <em>use the channel icon</em> follows this URL, so you only need to
            set it here — there is no need to upload the same image again in the watermark editor.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" loading={setImage.isPending} disabled={applyDisabled} onClick={apply}>
            {source === 'derive' ? 'Re-derive from icon' : 'Apply'}
          </Button>
        </div>
      </div>
    </ModalWrapper>
  )
}
