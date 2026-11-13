import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import type {
  ChannelCollection,
  SmartCollectionInput,
  SmartCollectionUpdateInput,
} from '@/shared/types'
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

/**
 * "Build/update this channel's own Plex collections."
 *
 * The two types are independent: a slot referencing an existing collection is
 * left alone and reported as skipped, so a channel can keep an assigned movie
 * collection while Linearr generates its shows. Building used to convert BOTH
 * slots to owned, which made that mixed setup impossible to hold — one build
 * discarded the assignment — so there is no longer a switch-back to warn about.
 *
 * `isPending` is exposed so callers can disable their control while it runs.
 */
export function useBuildChannelCollections() {
  const generate = useGenerateCollections()

  async function build(
    channelNumber: number,
    _collections?: { movie?: ChannelCollection; show?: ChannelCollection },
  ): Promise<void> {
    generate.mutate(channelNumber)
  }

  return { build, isPending: generate.isPending }
}

export function useGenerateCollections() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (channelNumber: number) => collectionsApi.generateCollections(channelNumber),
    onSuccess: (data, channelNumber) => {
      invalidateCollections(queryClient, channelNumber)
      // Removals are reported explicitly. "N added" alone gave no sign that a
      // removal had happened — or, when the type was being skipped, that it
      // had not — which is what made this look like it wasn't working.
      const parts: string[] = []
      for (const [label, entry] of [
        ['Movies', data.movie],
        ['Shows', data.show],
      ] as const) {
        if (!entry) continue
        if (entry.skipped) {
          parts.push(`${label}: skipped`)
          continue
        }
        const bits = [`${entry.added} added`]
        if (entry.removed) bits.push(`${entry.removed} removed`)
        parts.push(`${label}: ${bits.join(', ')}, ${entry.total} total`)
      }
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
