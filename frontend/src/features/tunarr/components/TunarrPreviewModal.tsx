import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { usePushSchedule } from '@/features/tunarr/hooks'
import type { TunarrScheduleItem } from '@/shared/types'

interface TunarrPreviewData {
  slots: number
  preview?: TunarrScheduleItem[]
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function itemTitle(item: TunarrScheduleItem): string {
  if (item.title) return item.title
  if (item.episode?.title) {
    const s = item.episode.season != null ? `S${item.episode.season}` : ''
    const e = item.episode.episode != null ? `E${item.episode.episode}` : ''
    return `${s}${e} — ${item.episode.title}`
  }
  return item.type
}

export function TunarrPreviewModal() {
  const open = useUIStore((s) => s.modals.tunarrPreview)
  const closeModal = useUIStore((s) => s.closeModal)
  const rawData = useUIStore((s) => s.tunarrPreviewData) as TunarrPreviewData | null
  const selectedChannel = useUIStore((s) => s.selectedChannel)

  const pushSchedule = usePushSchedule()

  const channelNumber = selectedChannel?.number ?? 0
  const preview = rawData?.preview ?? []
  const slots = rawData?.slots ?? 0

  const handleConfirm = () => {
    pushSchedule.mutate(
      { channelNumber, preview: false },
      {
        onSuccess: () => closeModal('tunarrPreview'),
      },
    )
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('tunarrPreview')} maxWidth="max-w-2xl">
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Schedule Preview</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {slots} slot{slots !== 1 ? 's' : ''} will be pushed
            </p>
          </div>
          <button
            onClick={() => closeModal('tunarrPreview')}
            className="text-slate-400 hover:text-slate-100 transition-colors"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {preview.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No preview items available
            </div>
          ) : (
            <div className="space-y-1">
              {preview.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/50 rounded-lg transition-colors"
                >
                  <span className="text-xs font-mono text-slate-500 w-14 shrink-0 text-right">
                    {formatTime(item.startTime)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-100 truncate">{itemTitle(item)}</p>
                    <p className="text-xs text-slate-500 capitalize">{item.type}</p>
                  </div>
                  <span className="text-xs text-slate-400 font-mono shrink-0">
                    {formatDuration(item.duration)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700 shrink-0">
          <button
            onClick={() => closeModal('tunarrPreview')}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={pushSchedule.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {pushSchedule.isPending && <Spinner size="sm" />}
            Confirm Push
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}
