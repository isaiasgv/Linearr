/**
 * Generate an icon for the selected channel.
 *
 * A thin shell around {@link IconGeneratorPanel}: the panel does the work, this
 * decides where the result goes — straight onto the channel, which also
 * re-uploads it to Tunarr and re-points a following watermark at it.
 */
import { IconButton, ModalWrapper } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useAssignIconToChannel } from '../hooks'
import { IconGeneratorPanel } from './IconGeneratorPanel'

const TITLE_ID = 'icon-generator-title'

export function IconGeneratorModal() {
  const open = useUIStore((s) => s.modals.iconGenerator)
  const closeModal = useUIStore((s) => s.closeModal)
  const openModal = useUIStore((s) => s.openModal)
  const snapshot = useUIStore((s) => s.selectedChannel)
  const { data: channels } = useChannels()
  const assign = useAssignIconToChannel()

  // The store snapshot goes stale after an edit; resolve against the cache.
  const channel = channels?.find((c) => c.number === snapshot?.number) ?? snapshot

  function close() {
    closeModal('iconGenerator')
  }

  return (
    <ModalWrapper open={open} onClose={close} maxWidth="max-w-2xl" titleId={TITLE_ID}>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="text-base font-semibold text-slate-100">
              Generate Channel Icon
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

        <div className="p-5">
          {channel ? (
            <IconGeneratorPanel
              channelName={channel.name}
              onGenerated={(dataUrl) =>
                assign.mutate(
                  { channelNumber: channel.number, iconData: dataUrl },
                  { onSuccess: close },
                )
              }
              onEditInDesigner={(composition) => {
                close()
                openModal('iconEditor', {
                  iconEditorComposition: composition,
                  iconEditorName: channel.name,
                })
              }}
            />
          ) : (
            <p className="text-sm text-slate-400">Select a channel first.</p>
          )}
        </div>
      </div>
    </ModalWrapper>
  )
}
