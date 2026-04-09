import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { channelsApi } from './api'
import type { Channel } from '@/shared/types'
import { useToastStore } from '@/shared/store/toast.store'

export function useChannels(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.list,
    enabled: options?.enabled !== false,
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (data: Partial<Channel>) => channelsApi.create(data),
    onSuccess: (ch) => {
      qc.setQueryData<Channel[]>(['channels'], (old = []) =>
        [...old, ch].sort((a, b) => a.number - b.number),
      )
      addToast(`Channel ${ch.number} created`)
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ number, data }: { number: number; data: Partial<Channel> }) =>
      channelsApi.update(number, data),
    onSuccess: (updated) => {
      qc.setQueryData<Channel[]>(['channels'], (old = []) =>
        old.map((c) => (c.number === updated.number ? updated : c)),
      )
      addToast(`Channel ${updated.number} updated`)
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (number: number) => channelsApi.remove(number),
    onSuccess: (_, number) => {
      qc.setQueryData<Channel[]>(['channels'], (old = []) => old.filter((c) => c.number !== number))
      qc.removeQueries({ queryKey: ['blocks', number] })
      qc.removeQueries({ queryKey: ['channel-collections', number] })
      qc.removeQueries({ queryKey: ['collection-status', number] })
      void qc.invalidateQueries({ queryKey: ['assignments'] })
      addToast('Channel deleted')
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}
