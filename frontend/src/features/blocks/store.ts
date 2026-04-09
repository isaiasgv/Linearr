import { create } from 'zustand'
import type { BlockSlot } from '@/shared/types'

interface BlockEditorState {
  expandedBlockId: number | null
  addingSlotForBlockId: number | null
  slotTargetHour: string | null
  slotSearch: string
  draggingSlot: BlockSlot | null
  dragOverHour: string | null
  networkSuggestionsOpen: boolean

  expandBlock: (id: number | null) => void
  startAddingSlot: (blockId: number, hour: string) => void
  cancelAddingSlot: () => void
  setSlotSearch: (q: string) => void
  setDraggingSlot: (slot: BlockSlot | null) => void
  setDragOverHour: (hour: string | null) => void
  setNetworkSuggestionsOpen: (open: boolean) => void
}

export const useBlockStore = create<BlockEditorState>((set) => ({
  expandedBlockId: null,
  addingSlotForBlockId: null,
  slotTargetHour: null,
  slotSearch: '',
  draggingSlot: null,
  dragOverHour: null,
  networkSuggestionsOpen: false,

  expandBlock: (id) =>
    set((s) => ({
      expandedBlockId: s.expandedBlockId === id ? null : id,
      addingSlotForBlockId: null,
      slotTargetHour: null,
      slotSearch: '',
    })),

  startAddingSlot: (blockId, hour) =>
    set({ addingSlotForBlockId: blockId, slotTargetHour: hour, slotSearch: '' }),

  cancelAddingSlot: () => set({ addingSlotForBlockId: null, slotTargetHour: null, slotSearch: '' }),

  setSlotSearch: (slotSearch) => set({ slotSearch }),
  setDraggingSlot: (draggingSlot) => set({ draggingSlot }),
  setDragOverHour: (dragOverHour) => set({ dragOverHour }),
  setNetworkSuggestionsOpen: (networkSuggestionsOpen) => set({ networkSuggestionsOpen }),
}))
