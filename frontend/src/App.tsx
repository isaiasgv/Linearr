import { lazy, Suspense, useEffect } from 'react'

import { AppLayout } from '@/shared/components/layout/AppLayout'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useAuthStore } from '@/features/auth/store'

import { LoginModal } from '@/features/auth/components/LoginModal'
import { ChannelSidebar } from '@/features/channels/components/ChannelSidebar'
import { ChannelDetail } from '@/features/channels/components/ChannelDetail'
import { EmptyState } from '@/features/channels/components/EmptyState'
import { useChannels } from '@/features/channels/hooks'
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts'
import { Logo } from '@/shared/components/ui/Logo'

// Lazy-load modals and heavy views — only loaded when first opened/displayed
const ChannelFormModal = lazy(() =>
  import('@/features/channels/components/ChannelFormModal').then((m) => ({
    default: m.ChannelFormModal,
  })),
)
const BlockFormModal = lazy(() =>
  import('@/features/blocks/components/BlockFormModal').then((m) => ({
    default: m.BlockFormModal,
  })),
)
const TemplatesLibraryModal = lazy(() =>
  import('@/features/blocks/components/TemplatesLibraryModal').then((m) => ({
    default: m.TemplatesLibraryModal,
  })),
)
const SettingsView = lazy(() =>
  import('@/features/settings/components/SettingsView').then((m) => ({
    default: m.SettingsView,
  })),
)
const CollectionPickerModal = lazy(() =>
  import('@/features/collections/components/CollectionPickerModal').then((m) => ({
    default: m.CollectionPickerModal,
  })),
)
const ItemDetailModal = lazy(() =>
  import('@/features/plex/components/ItemDetailModal').then((m) => ({
    default: m.ItemDetailModal,
  })),
)
const AiContentAdvisorModal = lazy(() =>
  import('@/features/ai/components/AiContentAdvisorModal').then((m) => ({
    default: m.AiContentAdvisorModal,
  })),
)
const NetworkAdvisorModal = lazy(() =>
  import('@/features/ai/components/NetworkAdvisorModal').then((m) => ({
    default: m.NetworkAdvisorModal,
  })),
)
const TunarrPreviewModal = lazy(() =>
  import('@/features/tunarr/components/TunarrPreviewModal').then((m) => ({
    default: m.TunarrPreviewModal,
  })),
)
const TunarrCollectionPickerModal = lazy(() =>
  import('@/features/tunarr/components/TunarrCollectionPickerModal').then((m) => ({
    default: m.TunarrCollectionPickerModal,
  })),
)
const IconEditorModal = lazy(() =>
  import('@/features/channels/components/IconEditorModal').then((m) => ({
    default: m.IconEditorModal,
  })),
)
const TunarrView = lazy(() =>
  import('@/features/tunarr/components/TunarrView').then((m) => ({ default: m.TunarrView })),
)
const GenericBlocksView = lazy(() =>
  import('@/features/generic-blocks/components/GenericBlocksView').then((m) => ({
    default: m.GenericBlocksView,
  })),
)
const CablePlexView = lazy(() =>
  import('@/features/cable-plex/components/CablePlexView').then((m) => ({
    default: m.CablePlexView,
  })),
)
const PlexView = lazy(() =>
  import('@/features/plex/components/PlexView').then((m) => ({ default: m.PlexView })),
)
const IconLibraryView = lazy(() =>
  import('@/features/icons/components/IconLibraryView').then((m) => ({
    default: m.IconLibraryView,
  })),
)

export default function App() {
  useKeyboardShortcuts()
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn)
  const activeView = useUIStore((s) => s.activeView)
  const selectedChannel = useUIStore((s) => s.selectedChannel)

  useEffect(() => {
    const handler = () => setLoggedIn(false)
    window.addEventListener('session-expired', handler)
    return () => window.removeEventListener('session-expired', handler)
  }, [setLoggedIn])

  const { isLoading } = useChannels({ enabled: isLoggedIn })

  if (!isLoggedIn) {
    return <LoginModal />
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-[#020617] items-center justify-center">
        <div style={{ animation: 'splash-pulse 2s ease-in-out infinite' }}>
          <Logo size={80} />
        </div>
        <p className="mt-4 text-lg font-semibold tracking-wide text-slate-400">Linearr</p>
      </div>
    )
  }

  return (
    <AppLayout sidebar={<ChannelSidebar />}>
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        }
      >
        {activeView === 'channel' && !selectedChannel && <EmptyState />}
        {activeView === 'channel' && selectedChannel && <ChannelDetail />}
        {activeView === 'generic' && <GenericBlocksView />}
        {activeView === 'tunarr' && <TunarrView />}
        {activeView === 'cableplex' && <CablePlexView />}
        {activeView === 'plex' && <PlexView />}
        {activeView === 'icons' && <IconLibraryView />}
        {activeView === 'settings' && <SettingsView />}

        {/* Modals — lazy-loaded, only fetched when first opened */}
        <ChannelFormModal />
        <BlockFormModal />
        <TemplatesLibraryModal />
        <CollectionPickerModal />
        <ItemDetailModal />
        <AiContentAdvisorModal />
        <NetworkAdvisorModal />
        <TunarrPreviewModal />
        <TunarrCollectionPickerModal />
        <IconEditorModal />
      </Suspense>
    </AppLayout>
  )
}
