import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { blocksApi } from './api'
import type { Block, BlockSlot } from '@/shared/types'
import { useToastStore } from '@/shared/store/toast.store'

export function useChannelBlocks(channelNumber: number) {
  return useQuery({
    queryKey: ['blocks', channelNumber],
    queryFn: () => blocksApi.listByChannel(channelNumber),
    enabled: channelNumber > 0,
  })
}

export function useGenericBlocks() {
  return useQuery({
    queryKey: ['blocks', 'generic'],
    queryFn: blocksApi.listGeneric,
  })
}

export function useBlockSlots(blockId: number, enabled = true) {
  return useQuery({
    queryKey: ['block-slots', blockId],
    queryFn: () => blocksApi.listSlots(blockId),
    enabled: enabled && blockId > 0,
  })
}

export function useBlockSuggestions(blockId: number, enabled = true) {
  return useQuery({
    queryKey: ['block-suggestions', blockId],
    queryFn: () => blocksApi.suggestions(blockId),
    enabled: enabled && blockId > 0,
  })
}

export function useCreateBlock() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (data: Partial<Block>) => blocksApi.create(data),
    onSuccess: (block) => {
      if (block.channel_number) {
        qc.setQueryData<Block[]>(['blocks', block.channel_number], (old = []) =>
          [...old, block]
        )
      } else {
        qc.setQueryData<Block[]>(['blocks', 'generic'], (old = []) => [...old, block])
      }
      addToast('Block created')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useUpdateBlock() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Block> }) =>
      blocksApi.update(id, data),
    onSuccess: (updated) => {
      const key: unknown[] = updated.channel_number
        ? ['blocks', updated.channel_number]
        : ['blocks', 'generic']
      qc.setQueryData<Block[]>(key, (old = []) =>
        old.map((b) => (b.id === updated.id ? updated : b))
      )
      addToast('Block updated')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useDeleteBlock() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ id, channelNumber }: { id: number; channelNumber: number | null }) => {
      void channelNumber
      return blocksApi.remove(id)
    },
    onSuccess: (_, { id, channelNumber }) => {
      const key: unknown[] = channelNumber ? ['blocks', channelNumber] : ['blocks', 'generic']
      qc.setQueryData<Block[]>(key, (old = []) => old.filter((b) => b.id !== id))
      addToast('Block deleted')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useApplyBlock() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ blockId, channelNumber }: { blockId: number; channelNumber: number }) =>
      blocksApi.applyToChannel(blockId, channelNumber),
    onSuccess: (block) => {
      qc.setQueryData<Block[]>(['blocks', block.channel_number], (old = []) =>
        [...old, block]
      )
      addToast('Block applied to channel')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useAddSlot() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ blockId, data }: { blockId: number; data: Partial<BlockSlot> }) =>
      blocksApi.addSlot(blockId, data),
    onSuccess: (slot) => {
      qc.setQueryData<BlockSlot[]>(['block-slots', slot.block_id], (old = []) =>
        [...old, slot]
      )
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useRemoveSlot() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ blockId, slotId }: { blockId: number; slotId: number }) =>
      blocksApi.removeSlot(blockId, slotId),
    onSuccess: (_, { blockId, slotId }) => {
      qc.setQueryData<BlockSlot[]>(['block-slots', blockId], (old = []) =>
        old.filter((s) => s.id !== slotId)
      )
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useClearSlots() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (blockId: number) => blocksApi.clearSlots(blockId),
    onSuccess: (_, blockId) => {
      qc.setQueryData(['block-slots', blockId], [])
      addToast('Block cleared')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useSwapSlots() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({
      blockId,
      slotId1,
      slotId2,
    }: {
      blockId: number
      slotId1: number
      slotId2: number
    }) => blocksApi.swapSlots(blockId, slotId1, slotId2),
    onSuccess: (_, { blockId }) => {
      qc.invalidateQueries({ queryKey: ['block-slots', blockId] })
    },
    onError: (err: Error) => addToast(err.message || 'Failed to swap slots', true),
  })
}

export function useUpdateSlot() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ slotId, data }: { slotId: number; data: Partial<BlockSlot> }) =>
      blocksApi.updateSlot(slotId, data),
    onSuccess: (updated) => {
      qc.setQueryData<BlockSlot[]>(['block-slots', updated.block_id], (old = []) =>
        old.map((s) => (s.id === updated.id ? updated : s))
      )
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useAiAutofill() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ blockId, model }: { blockId: number; model?: string }) =>
      blocksApi.aiAutofill(blockId, model),
    onSuccess: (result, { blockId }) => {
      qc.invalidateQueries({ queryKey: ['block-slots', blockId] })
      addToast(`AI filled ${result.filled} slots`)
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}
