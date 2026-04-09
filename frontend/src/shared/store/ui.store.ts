import { create } from 'zustand'
import type { Channel, Block, ModalName } from '@/shared/types'

export type ActiveView = 'channel' | 'generic' | 'tunarr' | 'cableplex' | 'plex' | 'icons' | 'settings'
export type ActiveChannelTab = 'content' | 'blocks' | 'tunarr'
export type TierFilter = 'All' | 'Galaxy Main' | 'Classics' | 'Galaxy Premium'
export type AssignedTypeFilter = 'all' | 'tv' | 'movies'

interface UIState {
  // Navigation
  selectedChannel: Channel | null
  activeView: ActiveView
  activeChannelTab: ActiveChannelTab
  tierFilter: TierFilter
  assignedTypeFilter: AssignedTypeFilter

  // Mobile sidebar drawer
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // Modal open/close flags
  modals: Record<ModalName, boolean>

  // Modal data payloads
  editingChannel: Channel | null
  editingBlock: Block | null
  collectionPickerType: 'movie' | 'show' | null
  itemDetailRatingKey: string | null
  aiContentAdvisorChannel: number | null
  tunarrPreviewData: unknown | null

  // Actions
  selectChannel: (channel: Channel | null) => void
  setActiveView: (view: ActiveView) => void
  setActiveChannelTab: (tab: ActiveChannelTab) => void
  setTierFilter: (filter: TierFilter) => void
  setAssignedTypeFilter: (filter: AssignedTypeFilter) => void

  openModal: (name: ModalName, data?: Partial<UIState>) => void
  closeModal: (name: ModalName) => void
  closeAllModals: () => void
}

const defaultModals: Record<ModalName, boolean> = {
  settings: false,
  channelForm: false,
  blockForm: false,
  collectionPicker: false,
  itemDetail: false,
  aiContentAdvisor: false,
  networkAdvisor: false,
  tunarrPreview: false,
  templatesLibrary: false,
  tunarrCollectionPicker: false,
  iconEditor: false,
}

export const useUIStore = create<UIState>((set) => ({
  selectedChannel: null,
  activeView: 'channel',
  activeChannelTab: 'content',
  tierFilter: 'All',
  assignedTypeFilter: 'all',

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  modals: { ...defaultModals },

  editingChannel: null,
  editingBlock: null,
  collectionPickerType: null,
  itemDetailRatingKey: null,
  aiContentAdvisorChannel: null,
  tunarrPreviewData: null,

  // Close sidebar on mobile when navigating
  selectChannel: (channel) =>
    set({
      selectedChannel: channel,
      activeView: 'channel',
      activeChannelTab: 'content',
      sidebarOpen: false,
    }),

  setActiveView: (activeView) => set({ activeView, sidebarOpen: false }),
  setActiveChannelTab: (activeChannelTab) => set({ activeChannelTab }),
  setTierFilter: (tierFilter) => set({ tierFilter }),
  setAssignedTypeFilter: (assignedTypeFilter) => set({ assignedTypeFilter }),

  openModal: (name, data) =>
    set((s) => ({
      modals: { ...s.modals, [name]: true },
      ...data,
    })),

  closeModal: (name) => set((s) => ({ modals: { ...s.modals, [name]: false } })),

  closeAllModals: () => set({ modals: { ...defaultModals } }),
}))
