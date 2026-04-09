import { get, post } from '@/shared/api/client'
import type { PlexCollection, PlexEpisode, PlexItem, PlexLibrary, PlexSeason } from '@/shared/types'

function libraries(): Promise<PlexLibrary[]> {
  return get<PlexLibrary[]>('/api/plex/libraries')
}

function libraryItems(sectionId: string, type?: string): Promise<PlexItem[]> {
  const params = type ? `?type_filter=${encodeURIComponent(type)}` : ''
  return get<PlexItem[]>(`/api/plex/library/${encodeURIComponent(sectionId)}${params}`)
}

function search(q: string, type?: string): Promise<PlexItem[]> {
  const params = new URLSearchParams({ q })
  if (type) params.set('type_filter', type)
  return get<PlexItem[]>(`/api/plex/search?${params.toString()}`)
}

function item(ratingKey: string): Promise<PlexItem> {
  return get<PlexItem>(`/api/plex/item/${encodeURIComponent(ratingKey)}`)
}

function seasons(ratingKey: string): Promise<PlexSeason[]> {
  return get<PlexSeason[]>(`/api/plex/show/${encodeURIComponent(ratingKey)}/seasons`)
}

function episodes(ratingKey: string): Promise<PlexEpisode[]> {
  return get<PlexEpisode[]>(`/api/plex/season/${encodeURIComponent(ratingKey)}/episodes`)
}

function collections(): Promise<PlexCollection[]> {
  return get<PlexCollection[]>('/api/plex/collections')
}

function collectionItems(ratingKey: string): Promise<PlexItem[]> {
  return get<PlexItem[]>(`/api/plex/collections/${encodeURIComponent(ratingKey)}/items`)
}

function startAuth(): Promise<{ auth_url: string; pin_id: string }> {
  return post<{ auth_url: string; pin_id: string }>('/api/plex/auth/start')
}

function authStatus(): Promise<{ done: boolean; token?: string }> {
  return get<{ done: boolean; token?: string }>('/api/plex/auth/status')
}

interface PlexServerInfo {
  server_name: string
  version: string
  platform: string
  username: string
  plex_pass: boolean
  machine_id: string
  library_count: number
  libraries: Array<{ id: string; title: string; type: string }>
}

interface PlexLibraryStat {
  id: string
  title: string
  type: string
  total_items: number
}

interface PlexRecentItem {
  rating_key: string
  title: string
  type: string
  year: number | null
  thumb: string | null
  added_at: number | null
}

function serverInfo(): Promise<PlexServerInfo> {
  return get<PlexServerInfo>('/api/plex/server-info')
}

function libraryStats(): Promise<PlexLibraryStat[]> {
  return get<PlexLibraryStat[]>('/api/plex/library-stats')
}

function recentlyAdded(limit = 20): Promise<PlexRecentItem[]> {
  return get<PlexRecentItem[]>(`/api/plex/recently-added?limit=${limit}`)
}

interface PlexOnDeckItem {
  rating_key: string
  title: string
  subtitle: string | null
  type: string
  year: number | null
  thumb: string | null
  added_at: number | null
}

function onDeck(limit = 20): Promise<PlexOnDeckItem[]> {
  return get<PlexOnDeckItem[]>(`/api/plex/on-deck?limit=${limit}`)
}

interface PlexPopularItem {
  rating_key: string
  title: string
  type: string
  year: number | null
  thumb: string | null
  view_count: number
}

function popular(limit = 30): Promise<PlexPopularItem[]> {
  return get<PlexPopularItem[]>(`/api/plex/popular?limit=${limit}`)
}

export const plexApi = {
  libraries,
  libraryItems,
  search,
  item,
  seasons,
  episodes,
  collections,
  collectionItems,
  startAuth,
  authStatus,
  serverInfo,
  libraryStats,
  recentlyAdded,
  onDeck,
  popular,
}

export type { PlexServerInfo, PlexLibraryStat, PlexRecentItem, PlexOnDeckItem, PlexPopularItem }
