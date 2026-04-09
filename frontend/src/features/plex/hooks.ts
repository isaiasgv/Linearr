import { useQuery } from '@tanstack/react-query'
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
