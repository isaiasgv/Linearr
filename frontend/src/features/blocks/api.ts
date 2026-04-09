import { get, post, put, del } from '@/shared/api/client'
import type { Block, BlockSlot, Assignment } from '@/shared/types'

export const blocksApi = {
  // Blocks
  listByChannel: (channelNumber: number) =>
    get<Block[]>(`/api/blocks/channel/${channelNumber}`),

  listGeneric: () => get<Block[]>('/api/blocks/generic'),

  create: (data: Partial<Block>) => post<Block>('/api/blocks', data),

  update: (id: number, data: Partial<Block>) =>
    put<Block>(`/api/blocks/${id}`, data),

  remove: (id: number) => del<void>(`/api/blocks/${id}`),

  applyToChannel: (blockId: number, channelNumber: number) =>
    post<Block>(`/api/blocks/${blockId}/apply/${channelNumber}`),

  // Slots
  listSlots: (blockId: number) =>
    get<BlockSlot[]>(`/api/blocks/${blockId}/slots`),

  addSlot: (blockId: number, data: Partial<BlockSlot>) =>
    post<BlockSlot>(`/api/blocks/${blockId}/slots`, data),

  updateSlot: (slotId: number, data: Partial<BlockSlot>) =>
    put<BlockSlot>(`/api/block-slots/${slotId}`, data),

  removeSlot: (_blockId: number, slotId: number) =>
    del<void>(`/api/block-slots/${slotId}`),

  clearSlots: (blockId: number) =>
    del<void>(`/api/blocks/${blockId}/slots`),

  swapSlots: (blockId: number, slotId1: number, slotId2: number) =>
    post<void>(`/api/blocks/${blockId}/swap-slots`, { slot_a: slotId1, slot_b: slotId2 }),

  // Suggestions (unscheduled assignments ranked for block)
  suggestions: (blockId: number) =>
    get<Assignment[]>(`/api/blocks/${blockId}/suggestions`),

  // AI autofill — backend returns {slots: [...]} suggestions, we POST each to create them
  aiAutofill: async (blockId: number, model?: string): Promise<{ filled: number }> => {
    const res = await post<{ slots: Array<Record<string, unknown>>; message?: string }>(
      `/api/blocks/${blockId}/ai-autofill`,
      { model },
    )
    const slots = res.slots ?? []
    if (slots.length === 0) return { filled: 0 }
    let filled = 0
    for (const s of slots) {
      try {
        await post(`/api/blocks/${blockId}/slots`, s)
        filled++
      } catch {
        // skip slots that fail (e.g. duplicate time)
      }
    }
    return { filled }
  },
}
