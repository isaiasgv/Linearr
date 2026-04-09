import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { collectionsApi } from './api'

export function useCollectionStatus(channelNumber: number) {
  return useQuery({
    queryKey: ['collection-status', channelNumber],
    queryFn: () => collectionsApi.getCollectionStatus(channelNumber),
    enabled: Boolean(channelNumber),
  })
}

export function useChannelCollections(channelNumber: number) {
  return useQuery({
    queryKey: ['channel-collections', channelNumber],
    queryFn: () => collectionsApi.getChannelCollections(channelNumber),
    enabled: Boolean(channelNumber),
  })
}

export function useGenerateCollections() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (channelNumber: number) => collectionsApi.generateCollections(channelNumber),
    onSuccess: (data, channelNumber) => {
      void queryClient.invalidateQueries({ queryKey: ['channel-collections', channelNumber] })
      void queryClient.invalidateQueries({ queryKey: ['collection-status', channelNumber] })
      const parts: string[] = []
      if (data.movie) parts.push(`Movies: ${data.movie.added} added, ${data.movie.total} total`)
      if (data.show) parts.push(`Shows: ${data.show.added} added, ${data.show.total} total`)
      addToast(parts.length > 0 ? parts.join(' | ') : 'Collections generated')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to generate collections', true)
    },
  })
}

interface LinkCollectionVars {
  channelNumber: number
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
}

export function useLinkCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, ...body }: LinkCollectionVars) =>
      collectionsApi.linkCollection(channelNumber, body),
    onSuccess: (data, { channelNumber }) => {
      queryClient.setQueryData(
        ['channel-collections', channelNumber],
        (prev: { movie?: unknown; show?: unknown } | undefined) => ({
          ...prev,
          [data.plex_type]: data,
        }),
      )
      void queryClient.invalidateQueries({ queryKey: ['collection-status', channelNumber] })
      addToast('Collection linked successfully')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to link collection', true)
    },
  })
}

interface UnlinkCollectionVars {
  channelNumber: number
  plexType: 'movie' | 'show'
}

export function useUnlinkCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, plexType }: UnlinkCollectionVars) =>
      collectionsApi.unlinkCollection(channelNumber, plexType),
    onSuccess: (_data, { channelNumber, plexType }) => {
      void queryClient.invalidateQueries({ queryKey: ['channel-collections', channelNumber] })
      void queryClient.invalidateQueries({ queryKey: ['collection-status', channelNumber] })
      addToast(`${plexType === 'movie' ? 'Movie' : 'Show'} collection unlinked`)
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to unlink collection', true)
    },
  })
}
