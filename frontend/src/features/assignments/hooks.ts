import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { assignmentsApi } from './api'
import type { Assignment, AssignmentsMap } from '@/shared/types'
import { useToastStore } from '@/shared/store/toast.store'

export function useAssignments() {
  return useQuery({
    queryKey: ['assignments'],
    queryFn: assignmentsApi.list,
  })
}

export function useChannelAssignments(channelNumber: number) {
  const { data: all = {}, ...rest } = useAssignments()
  return { data: (all[channelNumber] ?? []) as Assignment[], ...rest }
}

export function usePurgeChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({
      channelNumber,
      contentType,
    }: {
      channelNumber: number
      contentType: 'movies' | 'shows' | 'both'
    }) => assignmentsApi.purgeChannel(channelNumber, contentType),
    onSuccess: (result) => {
      addToast(`Removed ${result.removed} item${result.removed === 1 ? '' : 's'}`)
      qc.invalidateQueries({ queryKey: ['assignments'] })
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useAssign() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: assignmentsApi.assign,
    onSuccess: (assignment) => {
      qc.setQueryData<AssignmentsMap>(['assignments'], (old = {}) => {
        const list = old[assignment.channel_number] ?? []
        return {
          ...old,
          [assignment.channel_number]: [...list, assignment],
        }
      })
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({
      channelNumber,
      items,
    }: {
      channelNumber: number
      items: Omit<Assignment, 'id' | 'channel_number' | 'assigned_at'>[]
    }) => assignmentsApi.bulkAssign(channelNumber, items),
    onSuccess: (result, vars) => {
      addToast(`Added ${result.added}, skipped ${result.skipped}`)
      qc.invalidateQueries({ queryKey: ['assignments'] })
      void vars
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useUnassign() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ id, channelNumber }: { id: number; channelNumber: number }) => {
      void channelNumber
      return assignmentsApi.unassign(id)
    },
    onSuccess: (_, { id, channelNumber }) => {
      qc.setQueryData<AssignmentsMap>(['assignments'], (old = {}) => {
        const list = (old[channelNumber] ?? []).filter((a) => a.id !== id)
        return { ...old, [channelNumber]: list }
      })
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}
