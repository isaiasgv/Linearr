import { ModalWrapper } from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { TunarrGuide } from './TunarrGuide'

/**
 * One channel's slice of the Tunarr program guide, opened from the channel
 * actions menu. Reuses `TunarrGuide` with its `channelNumber` filter so the
 * timeline, now-marker and program bars are the same ones the full guide draws.
 */
export function ChannelGuideModal() {
  const open = useUIStore((s) => s.modals.channelGuide)
  const channelNumber = useUIStore((s) => s.channelGuideChannel)
  const closeModal = useUIStore((s) => s.closeModal)

  return (
    <ModalWrapper
      open={open}
      onClose={() => closeModal('channelGuide')}
      maxWidth="max-w-5xl"
      ariaLabel="Channel program guide"
    >
      <div className="h-[70vh] overflow-hidden rounded-xl">
        <TunarrGuide
          channelNumber={channelNumber ?? undefined}
          onClose={() => closeModal('channelGuide')}
        />
      </div>
    </ModalWrapper>
  )
}
