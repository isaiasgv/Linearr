import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { plexApi } from './api'

export function usePlexLibraries() {
  return useQuery({
    queryKey: ['plex', 'libraries'],
    queryFn: () => plexApi.libraries(),
  })
}

export function usePlexLibraryItems(sectionId: string, enabled = true) {
  return useQuery({
    queryKey: ['plex', 'library', sectionId],
    queryFn: () => plexApi.libraryItems(sectionId),
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
