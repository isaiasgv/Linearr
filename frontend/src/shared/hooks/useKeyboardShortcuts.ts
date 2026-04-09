import { useEffect } from 'react'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'

export function useKeyboardShortcuts() {
  const { closeAllModals, modals, selectedChannel, selectChannel, activeView, setSidebarOpen } =
    useUIStore()

  const { data: channels = [] } = useChannels()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Esc — close any open modal, or close sidebar
      if (e.key === 'Escape') {
        const anyOpen = Object.values(modals).some(Boolean)
        if (anyOpen) {
          closeAllModals()
          return
        }
        setSidebarOpen(false)
        return
      }

      // Don't intercept shortcuts when typing in an input
      if (isInput) return

      // j/k — navigate channels up/down (only in channel view)
      if (activeView === 'channel' && channels.length > 0 && (e.key === 'j' || e.key === 'k')) {
        e.preventDefault()
        const idx = selectedChannel
          ? channels.findIndex((c) => c.number === selectedChannel.number)
          : -1
        const next = e.key === 'j' ? Math.min(idx + 1, channels.length - 1) : Math.max(idx - 1, 0)
        selectChannel(channels[next])
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modals, closeAllModals, selectedChannel, selectChannel, channels, activeView, setSidebarOpen])
}
