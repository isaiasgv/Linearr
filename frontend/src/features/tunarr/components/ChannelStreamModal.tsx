import { useEffect, useRef, useState } from 'react'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { IconButton, ModalWrapper } from '@/shared/components/ui'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'

const TITLE_ID = 'channel-stream-title'

/**
 * Watch a channel's Tunarr stream inside Linearr.
 *
 * The stream is HLS. Safari plays it natively; Chrome and Firefox need
 * Media Source Extensions, which `hls.js` drives. hls.js is imported lazily so
 * the ~150 KB never lands in the main bundle for people who don't open this.
 *
 * The playlist comes from `/api/tunarr/stream/{tunarr_id}`, not from Tunarr
 * directly: Tunarr's own URLs point at its container hostname, which the browser
 * cannot resolve.
 */
export function ChannelStreamModal() {
  const open = useUIStore((s) => s.modals.channelStream)
  const channelNumber = useUIStore((s) => s.channelStreamChannel)
  const closeModal = useUIStore((s) => s.closeModal)
  const { data: links = [] } = useTunarrLinks()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'playing' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const link = links.find((l) => l.channel_number === channelNumber)
  const src = link ? `/api/tunarr/stream/${link.tunarr_id}` : null

  useEffect(() => {
    if (!open || !src) return
    const video = videoRef.current
    if (!video) return

    let destroyed = false
    // Typed loosely on purpose: hls.js ships its own types, but this file must
    // still compile when the package is absent from a lean install.
    let hls: { destroy: () => void } | null = null

    setStatus('starting')
    setMessage('Tunarr is starting the stream — this can take a few seconds.')

    async function start() {
      const native = video!.canPlayType('application/vnd.apple.mpegurl')
      if (native) {
        video!.src = src!
        return
      }
      try {
        const mod = await import('hls.js')
        const Hls = mod.default
        if (destroyed) return
        if (!Hls.isSupported()) {
          setStatus('error')
          setMessage('This browser cannot play HLS. Try Safari, or open the stream externally.')
          return
        }
        const instance = new Hls({ enableWorker: true, lowLatencyMode: false })
        hls = instance
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          setStatus('error')
          setMessage(
            data.response?.code === 502
              ? 'Linearr could not reach Tunarr for this stream.'
              : `Playback failed (${data.details}).`,
          )
        })
        instance.loadSource(src!)
        instance.attachMedia(video!)
      } catch {
        if (destroyed) return
        setStatus('error')
        setMessage('The HLS player failed to load.')
      }
    }
    void start()

    return () => {
      destroyed = true
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [open, src])

  return (
    <ModalWrapper
      open={open}
      onClose={() => closeModal('channelStream')}
      maxWidth="max-w-4xl"
      titleId={TITLE_ID}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
        <h2 id={TITLE_ID} className="text-base font-semibold text-slate-100">
          Watch Channel {channelNumber ?? ''}
        </h2>
        <IconButton label="Close" onClick={() => closeModal('channelStream')}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </div>

      <div className="p-5">
        {!link ? (
          <p className="text-sm text-slate-400">
            This channel isn’t linked to Tunarr yet. Link it on the channel’s Tunarr tab, then
            try again.
          </p>
        ) : (
          <div className="space-y-3">
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              className="w-full h-full"
              onPlaying={() => {
                setStatus('playing')
                setMessage('')
              }}
            />
            {status === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 pointer-events-none">
                <Spinner size="lg" />
                <p className="text-xs text-slate-300 px-4 text-center">{message}</p>
              </div>
            )}
          </div>

            {status === 'error' && <p className="text-sm text-red-400">{message}</p>}

            <p className="text-xs text-slate-500">
              Streaming through Linearr from{' '}
              <code className="text-slate-400">{link.tunarr_name || link.tunarr_id}</code>. Tunarr
              transcodes on demand, so the first few seconds can stutter.
            </p>
          </div>
        )}
      </div>
    </ModalWrapper>
  )
}
