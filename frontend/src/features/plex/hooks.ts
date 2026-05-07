import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { plexApi } from './api'

export function usePlexLibraries() {
  return useQuery({
    queryKey: ['plex', 'libraries'],
    queryFn: () => plexApi.libraries(),
  })
}

export function usePlexLibraryItems(
  sectionId: string,
  enabled = true,
  filters?: { genre?: string; year?: number; content_rating?: string },
) {
  return useQuery({
    queryKey: ['plex', 'library', sectionId, filters],
    queryFn: () => plexApi.libraryItems(sectionId, undefined, filters),
    enabled: enabled && Boolean(sectionId),
  })
}

export function usePlexSearch(query: string, typeFilter?: string, enabled = true) {
  return useQuery({
    queryKey: ['plex', 'search', { query, typeFilter }],
    queryFn: () => plexApi.search(query, typeFilter),
    enabled: enabled && query.trim().length > 0,
  })
}

export function usePlexItem(ratingKey: string) {
  return useQuery({
    queryKey: ['plex', 'item', ratingKey],
    queryFn: () => plexApi.item(ratingKey),
    enabled: Boolean(ratingKey),
  })
}

export function usePlexSeasons(ratingKey: string) {
  return useQuery({
    queryKey: ['plex', 'seasons', ratingKey],
    queryFn: () => plexApi.seasons(ratingKey),
    enabled: Boolean(ratingKey),
  })
}

export function usePlexEpisodes(ratingKey: string) {
  return useQuery({
    queryKey: ['plex', 'episodes', ratingKey],
    queryFn: () => plexApi.episodes(ratingKey),
    enabled: Boolean(ratingKey),
  })
}

export function usePlexCollections() {
  return useQuery({
    queryKey: ['plex', 'collections'],
    queryFn: () => plexApi.collections(),
  })
}

export function usePlexCollectionItems(ratingKey: string) {
  return useQuery({
    queryKey: ['plex', 'collection-items', ratingKey],
    queryFn: () => plexApi.collectionItems(ratingKey),
    enabled: Boolean(ratingKey),
  })
}

export function usePlexServerInfo() {
  return useQuery({
    queryKey: ['plex', 'server-info'],
    queryFn: () => plexApi.serverInfo(),
  })
}

export function usePlexLibraryStats() {
  return useQuery({
    queryKey: ['plex', 'library-stats'],
    queryFn: () => plexApi.libraryStats(),
  })
}

export function usePlexRecentlyAdded(limit = 20) {
  return useQuery({
    queryKey: ['plex', 'recently-added', limit],
    queryFn: () => plexApi.recentlyAdded(limit),
  })
}

export function usePlexOnDeck(limit = 20) {
  return useQuery({
    queryKey: ['plex', 'on-deck', limit],
    queryFn: () => plexApi.onDeck(limit),
  })
}

export function usePlexPopular(limit = 30) {
  return useQuery({
    queryKey: ['plex', 'popular', limit],
    queryFn: () => plexApi.popular(limit),
  })
}

export function usePlexSessions() {
  return useQuery({
    queryKey: ['plex', 'sessions'],
    queryFn: () => plexApi.sessions(),
    refetchInterval: 30_000,
  })
}

export function usePlexHistory(limit = 50) {
  return useQuery({
    queryKey: ['plex', 'history', limit],
    queryFn: () => plexApi.history(limit),
  })
}

export function usePlexPlaylists() {
  return useQuery({
    queryKey: ['plex', 'playlists'],
    queryFn: () => plexApi.playlists(),
  })
}

export function usePlexEvents(eventType?: string, limit = 50) {
  return useQuery({
    queryKey: ['plex', 'events', eventType, limit],
    queryFn: () => plexApi.events(eventType, limit),
    refetchInterval: 30_000,
  })
}

export function useClearPlexEvents() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: () => plexApi.clearEvents(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plex', 'events'] })
      addToast('Events cleared')
    },
    onError: (e: Error) => addToast(e.message || 'Failed to clear events', true),
  })
}

export function useCreateCollection() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (body: { title: string; section_id: string; type: string }) =>
      plexApi.createCollection(body),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
      addToast(`Collection "${data.title}" created`)
    },
    onError: (e: Error) => addToast(e.message || 'Failed to create collection', true),
  })
}

export function useDeleteCollection() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (ratingKey: string) => plexApi.deleteCollection(ratingKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
      addToast('Collection deleted')
    },
    onError: (e: Error) => addToast(e.message || 'Failed to delete collection', true),
  })
}

export function useAddCollectionItems() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({ ratingKey, items }: { ratingKey: string; items: string[] }) =>
      plexApi.addCollectionItems(ratingKey, items),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
      void qc.invalidateQueries({ queryKey: ['plex', 'collection-items'] })
      addToast(`${data.added} item${data.added !== 1 ? 's' : ''} added to collection`)
    },
    onError: (e: Error) => addToast(e.message || 'Failed to add items', true),
  })
}

export function useRemoveCollectionItem() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({ ratingKey, itemKey }: { ratingKey: string; itemKey: string }) =>
      plexApi.removeCollectionItem(ratingKey, itemKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
      void qc.invalidateQueries({ queryKey: ['plex', 'collection-items'] })
      addToast('Item removed from collection')
    },
    onError: (e: Error) => addToast(e.message || 'Failed to remove item', true),
  })
}

export function useUpdateCollection() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({
      ratingKey,
      body,
    }: {
      ratingKey: string
      body: { title?: string; summary?: string }
    }) => plexApi.updateCollection(ratingKey, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plex', 'collections'] })
      addToast('Collection updated')
    },
    onError: (e: Error) => addToast(e.message || 'Failed to update collection', true),
  })
}

export function usePlexLibraryFilters(sectionId: string) {
  return useQuery({
    queryKey: ['plex', 'library-filters', sectionId],
    queryFn: () => plexApi.libraryFilters(sectionId),
    enabled: Boolean(sectionId),
  })
}

export function useRateItem() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({ ratingKey, rating }: { ratingKey: string; rating: number }) =>
      plexApi.rateItem(ratingKey, rating),
    onSuccess: (_data, { ratingKey }) => {
      void qc.invalidateQueries({ queryKey: ['plex', 'item', ratingKey] })
      addToast('Rating saved')
    },
    onError: (e: Error) => addToast(e.message || 'Failed to save rating', true),
  })
}

export function usePlexHubs() {
  return useQuery({
    queryKey: ['plex', 'hubs'],
    queryFn: () => plexApi.hubs(),
  })
}

export function usePlexLibraryHubs(sectionId: string) {
  return useQuery({
    queryKey: ['plex', 'library-hubs', sectionId],
    queryFn: () => plexApi.libraryHubs(sectionId),
    enabled: Boolean(sectionId),
  })
}

export function useScanLibrary() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: (sectionId: string) => plexApi.scanLibrary(sectionId),
    onSuccess: () => {
      addToast('Library scan started')
      void qc.invalidateQueries({ queryKey: ['plex', 'library-stats'] })
    },
    onError: (e: Error) => addToast(e.message || 'Scan failed', true),
  })
}
