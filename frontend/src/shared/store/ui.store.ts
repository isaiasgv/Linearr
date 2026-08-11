import { create } from 'zustand'
import type { Channel, Block, ModalName, PlexItem } from '@/shared/types'

export type ActiveView =
  | 'channel'
  | 'generic'
  | 'tunarr'
  | 'cableplex'
  | 'plex'
  | 'icons'
  | 'settings'
export type ActiveChannelTab = 'content' | 'blocks' | 'tunarr'
export type TierFilter = 'All' | 'Galaxy Main' | 'Classics' | 'Galaxy Premium'
export type AssignedTypeFilter = 'all' | 'tv' | 'movies'

/** Payload for editing an existing smart collection's filters in the builder. */
export interface SmartBuilderEditTarget {
  ratingKey: string
  title: string
}

interface UIState {
  // Navigation
  selectedChannel: Channel | null
  activeView: ActiveView
  activeChannelTab: ActiveChannelTab
  tierFilter: TierFilter
  assignedTypeFilter: AssignedTypeFilter

  // Channel drag-to-reorder (native HTML5 DnD — same idiom as the block
  // HourGrid). Numbers, not Channel objects: a reorder renumbers, so a captured
  // object would go stale the moment the mutation lands.
  draggingChannelNumber: number | null
  dragOverChannelNumber: number | null
  setDraggingChannel: (number: number | null) => void
  setDragOverChannel: (number: number | null) => void
  clearChannelDrag: () => void

  // Plex item drag-to-assign (native HTML5 DnD — same idiom as the block
  // HourGrid). The dragged payload is the caller's whole selection when the
  // grabbed poster is part of it, otherwise just that one poster.
  draggingPlexItems: PlexItem[] | null
  plexDropChannelNumber: number | null
  setDraggingPlexItems: (items: PlexItem[] | null) => void
  setPlexDropChannel: (number: number | null) => void
  clearPlexDrag: () => void

  // Mobile sidebar drawer
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // Desktop sidebar collapse (icon rail) — persisted to localStorage
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void

  // Modal open/close flags
  modals: Record<ModalName, boolean>

  // Modal data payloads
  editingChannel: Channel | null
  editingBlock: Block | null
  collectionPickerType: 'movie' | 'show' | null
  // Per-channel collection slot modals (assign existing / smart builder). The
  // channel is carried explicitly rather than read from selectedChannel so the
  // modal can never act on a different channel than the one it was opened from.
  collectionSlotChannel: number | null
  collectionSlotType: 'movie' | 'show' | null
  /** Non-null → the smart builder edits this collection's filters instead of creating one. */
  smartBuilderEdit: SmartBuilderEditTarget | null
  itemDetailRatingKey: string | null
  aiContentAdvisorChannel: number | null
  /** Channel the add-content picker adds to (carried, never inferred). */
  addContentChannel: number | null
  /** Channel whose Tunarr guide row the guide modal shows. */
  channelGuideChannel: number | null
  /** Channel the stream player plays. */
  channelStreamChannel: number | null
  tunarrPreviewData: unknown | null
  iconPickerCallback: ((dataUrl: string) => void) | null
  iconEditorCallback: ((dataUrl: string, composition?: unknown) => void) | null
  iconEditorComposition: unknown | null
  iconEditorId: number | null
  iconEditorName: string | null

  // Actions
  selectChannel: (channel: Channel | null) => void
  setActiveView: (view: ActiveView) => void
  setActiveChannelTab: (tab: ActiveChannelTab) => void
  setTierFilter: (filter: TierFilter) => void
  setAssignedTypeFilter: (filter: AssignedTypeFilter) => void

  // Browse view preferences (persisted)
  browseViewMode: BrowseViewMode
  setBrowseViewMode: (mode: BrowseViewMode) => void
  browsePosterSize: BrowsePosterSize
  setBrowsePosterSize: (size: BrowsePosterSize) => void

  // Cable Plex view preferences (persisted) — defaults to the expanded layout,
  // but a previously persisted choice always wins.
  cablePlexViewMode: CablePlexViewMode
  setCablePlexViewMode: (mode: CablePlexViewMode) => void
  cablePlexPosterSize: BrowsePosterSize
  setCablePlexPosterSize: (size: BrowsePosterSize) => void

  openModal: (name: ModalName, data?: Partial<UIState>) => void
  closeModal: (name: ModalName) => void
  closeAllModals: () => void
}

const SIDEBAR_COLLAPSED_KEY = 'linearr:sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore (private mode / SSR) */
  }
}

const BROWSE_VIEW_KEY = 'linearr:browseViewMode'
const BROWSE_SIZE_KEY = 'linearr:browsePosterSize'
const CABLE_PLEX_VIEW_KEY = 'linearr:cablePlexViewMode'
const CABLE_PLEX_SIZE_KEY = 'linearr:cablePlexPosterSize'

type BrowseViewMode = 'wall' | 'grid' | 'list'
type BrowsePosterSize = 'small' | 'medium' | 'large'
export type CablePlexViewMode = 'compact' | 'expanded'

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

const defaultModals: Record<ModalName, boolean> = {
  channelForm: false,
  blockForm: false,
  itemDetail: false,
  aiContentAdvisor: false,
  networkAdvisor: false,
  tunarrPreview: false,
  templatesLibrary: false,
  tunarrCollectionPicker: false,
  assignCollection: false,
  smartCollectionBuilder: false,
  iconEditor: false,
  iconGenerator: false,
  iconPicker: false,
  watermarkEditor: false,
  addContent: false,
  channelGuide: false,
  channelStream: false,
}

export const useUIStore = create<UIState>((set) => ({
  selectedChannel: null,
  activeView: 'channel',
  activeChannelTab: 'content',
  tierFilter: 'All',
  assignedTypeFilter: 'all',

  draggingChannelNumber: null,
  dragOverChannelNumber: null,
  setDraggingChannel: (draggingChannelNumber) => set({ draggingChannelNumber }),
  setDragOverChannel: (dragOverChannelNumber) => set({ dragOverChannelNumber }),
  clearChannelDrag: () => set({ draggingChannelNumber: null, dragOverChannelNumber: null }),

  draggingPlexItems: null,
  plexDropChannelNumber: null,
  setDraggingPlexItems: (draggingPlexItems) => set({ draggingPlexItems }),
  setPlexDropChannel: (plexDropChannelNumber) => set({ plexDropChannelNumber }),
  clearPlexDrag: () => set({ draggingPlexItems: null, plexDropChannelNumber: null }),

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  sidebarCollapsed: readCollapsed(),
  setSidebarCollapsed: (sidebarCollapsed) => {
    writeCollapsed(sidebarCollapsed)
    set({ sidebarCollapsed })
  },
  toggleSidebarCollapsed: () =>
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed
      writeCollapsed(sidebarCollapsed)
      return { sidebarCollapsed }
    }),

  modals: { ...defaultModals },

  editingChannel: null,
  editingBlock: null,
  collectionPickerType: null,
  collectionSlotChannel: null,
  collectionSlotType: null,
  smartBuilderEdit: null,
  itemDetailRatingKey: null,
  aiContentAdvisorChannel: null,
  addContentChannel: null,
  channelGuideChannel: null,
  channelStreamChannel: null,
  tunarrPreviewData: null,
  iconPickerCallback: null,
  iconEditorCallback: null,
  iconEditorComposition: null,
  iconEditorId: null,
  iconEditorName: null,

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

  browseViewMode: readLS<BrowseViewMode>(BROWSE_VIEW_KEY, ['wall', 'grid', 'list'], 'wall'),
  setBrowseViewMode: (browseViewMode) => {
    writeLS(BROWSE_VIEW_KEY, browseViewMode)
    set({ browseViewMode })
  },
  browsePosterSize: readLS<BrowsePosterSize>(
    BROWSE_SIZE_KEY,
    ['small', 'medium', 'large'],
    'medium',
  ),
  setBrowsePosterSize: (browsePosterSize) => {
    writeLS(BROWSE_SIZE_KEY, browsePosterSize)
    set({ browsePosterSize })
  },

  cablePlexViewMode: readLS<CablePlexViewMode>(
    CABLE_PLEX_VIEW_KEY,
    ['compact', 'expanded'],
    'expanded',
  ),
  setCablePlexViewMode: (cablePlexViewMode) => {
    writeLS(CABLE_PLEX_VIEW_KEY, cablePlexViewMode)
    set({ cablePlexViewMode })
  },
  cablePlexPosterSize: readLS<BrowsePosterSize>(
    CABLE_PLEX_SIZE_KEY,
    ['small', 'medium', 'large'],
    'medium',
  ),
  setCablePlexPosterSize: (cablePlexPosterSize) => {
    writeLS(CABLE_PLEX_SIZE_KEY, cablePlexPosterSize)
    set({ cablePlexPosterSize })
  },

  openModal: (name, data) =>
    set((s) => ({
      modals: { ...s.modals, [name]: true },
      ...data,
    })),

  closeModal: (name) => set((s) => ({ modals: { ...s.modals, [name]: false } })),

  closeAllModals: () => set({ modals: { ...defaultModals } }),
}))
