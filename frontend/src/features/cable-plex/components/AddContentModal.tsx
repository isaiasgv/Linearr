import { IconButton, ModalWrapper } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { AddContentPanel } from './AddContentPanel'

/**
 * Propless, store-driven picker: browse Plex and add one or many items to the
 * channel carried in `addContentChannel`. Opened from the Cable Plex channel
 * cards via `openModal('addContent', { addContentChannel: ch.number })`.
 */
export function AddContentModal() {
  const open = useUIStore((s) => s.modals.addContent)
  const channelNumber = useUIStore((s) => s.addContentChannel)
  const closeModal = useUIStore((s) => s.closeModal)
  const { data: channels = [] } = useChannels()

  const channel = channels.find((c) => c.number === channelNumber)
  const close = () => closeModal('addContent')

  return (
    <ModalWrapper
      open={open && channelNumber !== null}
      onClose={close}
      maxWidth="max-w-6xl"
      titleId="add-content-title"
    >
      <div className="flex flex-col h-[80vh] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="min-w-0">
            <h2 id="add-content-title" className="text-base font-semibold text-slate-100 truncate">
              Add content
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {channel
                ? `Ch ${channel.number} · ${channel.name}`
                : channelNumber !== null
                  ? `Channel ${channelNumber}`
                  : 'No channel selected'}
            </p>
          </div>
          <IconButton label="Close" onClick={close}>
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>

        {channelNumber !== null && (
          <AddContentPanel
            key={channelNumber}
            channelNumber={channelNumber}
            className="flex-1 min-h-0"
          />
        )}
      </div>
    </ModalWrapper>
  )
}
