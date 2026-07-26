import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { watermarkApi, type TunarrSync } from './api'
import type { Watermark } from './types'

export function useWatermark(channelNumber: number) {
  return useQuery({
    queryKey: ['watermark', channelNumber],
    queryFn: () => watermarkApi.getWatermark(channelNumber),
    enabled: Boolean(channelNumber),
  })
}

/**
 * Shared mutation shell for the three watermark writes.
 *
 * Reports a Tunarr sync failure separately from a request failure: the local
 * save still succeeded, so the toast says so rather than implying nothing was
 * stored.
 */
function useWatermarkMutation<TVars>(
  fn: (vars: TVars) => Promise<{ tunarr_sync?: TunarrSync }>,
  channelNumber: number,
  successMessage: string,
) {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['watermark', channelNumber] })
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      void queryClient.invalidateQueries({ queryKey: ['tunarr', 'channels'] })
      const sync = data?.tunarr_sync
      if (sync && !sync.synced) {
        addToast(
          `${successMessage}, but Tunarr sync failed: ${sync.message ?? 'unknown error'}`,
          true,
        )
      } else {
        addToast(successMessage)
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'Watermark update failed', true)
    },
  })
}

export function useSaveWatermark(channelNumber: number) {
  return useWatermarkMutation<Watermark>(
    (data) => watermarkApi.saveWatermark(channelNumber, data),
    channelNumber,
    'Watermark saved',
  )
}

export function useDeleteWatermark(channelNumber: number) {
  return useWatermarkMutation<void>(
    () => watermarkApi.deleteWatermark(channelNumber),
    channelNumber,
    'Watermark cleared',
  )
}

export function useSetWatermarkImage(channelNumber: number) {
  return useWatermarkMutation<{ image?: string; url?: string }>(
    (payload) => watermarkApi.setWatermarkImage(channelNumber, payload),
    channelNumber,
    'Watermark image updated',
  )
}
