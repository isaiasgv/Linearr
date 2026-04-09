import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { iconsApi } from './api'

export function useSavedIcons() {
  return useQuery({
    queryKey: ['icons', 'library'],
    queryFn: () => iconsApi.listIcons(),
  })
}

export function useSaveIcon() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (body: { name: string; category: string; data: string }) => iconsApi.saveIcon(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['icons', 'library'] })
      addToast('Icon saved to library')
    },
    onError: (err: Error) => addToast(err.message || 'Failed to save icon', true),
  })
}

export function useDeleteSavedIcon() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (id: number) => iconsApi.deleteIcon(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['icons', 'library'] })
      addToast('Icon deleted')
    },
    onError: (err: Error) => addToast(err.message || 'Failed to delete icon', true),
  })
}

export function useSeedIconPack() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (pack: {
      icons: Array<{ name: string; category: string; data: string; channel?: string | null }>
    }) => iconsApi.seedPack(pack),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['icons', 'library'] })
      void qc.invalidateQueries({ queryKey: ['channels'] })
      addToast(`Imported ${data.created} icons, ${data.assigned} assigned to channels`)
    },
    onError: (err: Error) => addToast(err.message || 'Failed to import pack', true),
  })
}

export function useImportFromTunarr() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: () => iconsApi.importFromTunarr(),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['icons', 'library'] })
      void qc.invalidateQueries({ queryKey: ['channels'] })
      addToast(`Imported ${data.imported} icons from Tunarr, ${data.assigned} assigned`)
    },
    onError: (err: Error) => addToast(err.message || 'Failed to import from Tunarr', true),
  })
}

export function useAssignIconToChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({ channelNumber, iconData }: { channelNumber: number; iconData: string }) =>
      iconsApi.assignToChannel(channelNumber, iconData),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['channels'] })
      addToast('Icon assigned to channel')
    },
    onError: (err: Error) => addToast(err.message || 'Failed to assign icon', true),
  })
}
