import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import type { SmartCollectionInput, SmartCollectionUpdateInput } from '@/shared/types'
import { collectionsApi, type AssignCollectionBody } from './api'

/** Every collection mutation moves the same three caches. */
function invalidateCollections(qc: QueryClient, channelNumber: number): void {
  void qc.invalidateQueries({ queryKey: ['channel-collections', channelNumber] })
  void qc.invalidateQueries({ queryKey: ['collection-status', channelNumber] })
  void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
}

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
      invalidateCollections(queryClient, channelNumber)
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
      invalidateCollections(queryClient, channelNumber)
      addToast(
        `${plexType === 'movie' ? 'Movie' : 'Show'} collection unassigned — the Plex collection itself was not touched`,
      )
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to unassign collection', true)
    },
  })
}

// ── Assign an existing collection by reference ───────────────────────────────

interface AssignCollectionVars {
  channelNumber: number
  body: AssignCollectionBody
}

export function useAssignCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, body }: AssignCollectionVars) =>
      collectionsApi.assignCollection(channelNumber, body),
    onSuccess: (data, { channelNumber }) => {
      invalidateCollections(queryClient, channelNumber)
      addToast(`Assigned "${data.collection_title}" — Linearr references it, never edits it`)
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to assign collection', true)
    },
  })
}

// ── Smart collections ────────────────────────────────────────────────────────

interface CreateSmartCollectionVars {
  channelNumber: number
  body: SmartCollectionInput
}

/** Create a Plex smart collection and assign it to the channel in one action. */
export function useCreateSmartCollectionForChannel() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, body }: CreateSmartCollectionVars) =>
      collectionsApi.createSmartCollectionForChannel(channelNumber, body),
    onSuccess: (data, { channelNumber }) => {
      invalidateCollections(queryClient, channelNumber)
      const unresolved = data.unresolved_genres ?? []
      addToast(
        unresolved.length > 0
          ? `Created + assigned "${data.title}" — genres not in this library were ignored: ${unresolved.join(', ')}`
          : `Created + assigned smart collection "${data.title}"`,
        unresolved.length > 0,
      )
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to create smart collection', true)
    },
  })
}

interface UpdatePlexSmartCollectionVars {
  ratingKey: string
  /** Only used for cache invalidation — the endpoint itself is channel-agnostic. */
  channelNumber: number
  body: SmartCollectionUpdateInput
}

/**
 * Edit a Plex smart collection's filter rules (and/or title).
 * Named `...PlexSmart...` to stay distinct from the Tunarr-side
 * `useUpdateSmartCollection` in `features/tunarr/hooks`.
 */
export function useUpdatePlexSmartCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ ratingKey, body }: UpdatePlexSmartCollectionVars) =>
      collectionsApi.updateSmartCollection(ratingKey, body),
    onSuccess: (data, { channelNumber }) => {
      invalidateCollections(queryClient, channelNumber)
      const unresolved = data.unresolved_genres ?? []
      addToast(
        unresolved.length > 0
          ? `Filters updated — genres not in this library were ignored: ${unresolved.join(', ')}`
          : 'Smart collection filters updated',
        unresolved.length > 0,
      )
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to update smart collection', true)
    },
  })
}

interface DeletePlexCollectionVars {
  ratingKey: string
  /** Only used for cache invalidation. */
  channelNumber: number
  title?: string
}

/** Delete the real Plex collection (and every channel slot referencing it). */
export function useDeletePlexCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ ratingKey }: DeletePlexCollectionVars) =>
      collectionsApi.deletePlexCollection(ratingKey),
    onSuccess: (_data, { channelNumber, title }) => {
      invalidateCollections(queryClient, channelNumber)
      addToast(title ? `Deleted "${title}" from Plex` : 'Collection deleted from Plex')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to delete collection', true)
    },
  })
}
