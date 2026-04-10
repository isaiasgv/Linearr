import { get, post, put, del } from '@/shared/api/client'
import type { PlexCollection, PlexEpisode, PlexItem, PlexLibrary, PlexSeason } from '@/shared/types'

function libraries(): Promise<PlexLibrary[]> {
  return get<PlexLibrary[]>('/api/plex/libraries')
}

interface LibraryFilters {
  genre?: string
  year?: number
  content_rating?: string
}

function libraryItems(sectionId: string, type?: string, filters?: LibraryFilters): Promise<PlexItem[]> {
  const params = new URLSearchParams()
  if (type) params.set('type_filter', type)
  if (filters?.genre) params.set('genre', filters.genre)
  if (filters?.year) params.set('year', String(filters.year))
  if (filters?.content_rating) params.set('content_rating', filters.content_rating)
  const qs = params.toString()
  return get<PlexItem[]>(`/api/plex/library/${encodeURIComponent(sectionId)}${qs ? `?${qs}` : ''}`)
}

interface LibraryFilterOptions {
  genres: string[]
  years: string[]
  content_ratings: string[]
}

function libraryFilters(sectionId: string): Promise<LibraryFilterOptions> {
  return get<LibraryFilterOptions>(`/api/plex/library/${encodeURIComponent(sectionId)}/filters`)
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

interface PlexSession {
  title: string
  subtitle: string | null
  type: string
  thumb: string | null
  user: string
  player: string
  platform: string
  state: string
  progress_pct: number
  transcode: boolean
  video_resolution: string
  bandwidth_kbps: number | null
}

interface PlexHistoryItem {
  rating_key: string
  title: string
  subtitle: string | null
  type: string
  thumb: string | null
  viewed_at: number | null
}

interface PlexPlaylist {
  rating_key: string
  title: string
  type: string
  item_count: number
  duration_ms: number
  thumb: string | null
  smart: boolean
}

function sessions(): Promise<PlexSession[]> {
  return get<PlexSession[]>('/api/plex/sessions')
}

function history(limit = 50): Promise<PlexHistoryItem[]> {
  return get<PlexHistoryItem[]>(`/api/plex/history?limit=${limit}`)
}

function playlists(): Promise<PlexPlaylist[]> {
  return get<PlexPlaylist[]>('/api/plex/playlists')
}

function scanLibrary(sectionId: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/plex/scan-library/${encodeURIComponent(sectionId)}`)
}

function rateItem(ratingKey: string, rating: number): Promise<{ ok: boolean }> {
  return put<{ ok: boolean }>(`/api/plex/item/${encodeURIComponent(ratingKey)}/rate`, { rating })
}

// ── Webhook events ───────────────────────────────────────────────────────────

interface PlexEvent {
  id: number
  event_type: string
  rating_key: string | null
  title: string | null
  plex_type: string | null
  user_name: string | null
  player: string | null
  created_at: string
}

function events(eventType?: string, limit = 50): Promise<PlexEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (eventType) params.set('event_type', eventType)
  return get<PlexEvent[]>(`/api/plex/events?${params.toString()}`)
}

function clearEvents(): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>('/api/plex/events')
}

// ── Collection CRUD ──────────────────────────────────────────────────────────

function createCollection(body: { title: string; section_id: string; type: string }): Promise<{ rating_key: string; title: string }> {
  return post<{ rating_key: string; title: string }>('/api/plex/collections', body)
}

function deleteCollection(ratingKey: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/plex/collections/${encodeURIComponent(ratingKey)}`)
}

function addCollectionItems(ratingKey: string, items: string[]): Promise<{ ok: boolean; added: number }> {
  return put<{ ok: boolean; added: number }>(`/api/plex/collections/${encodeURIComponent(ratingKey)}/items`, { items })
}

function removeCollectionItem(ratingKey: string, itemKey: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/plex/collections/${encodeURIComponent(ratingKey)}/items/${encodeURIComponent(itemKey)}`)
}

function updateCollection(ratingKey: string, body: { title?: string; summary?: string }): Promise<{ ok: boolean }> {
  return put<{ ok: boolean }>(`/api/plex/collections/${encodeURIComponent(ratingKey)}`, body)
}

interface PlexHub {
  title: string
  type: string
  hub_key: string
  items: Array<{
    rating_key: string
    title: string
    subtitle?: string | null
    type: string
    year?: number | null
    thumb: string | null
  }>
}

function hubs(): Promise<{ hubs: PlexHub[] }> {
  return get<{ hubs: PlexHub[] }>('/api/plex/hubs')
}

function libraryHubs(sectionId: string): Promise<{ hubs: PlexHub[] }> {
  return get<{ hubs: PlexHub[] }>(`/api/plex/hubs/library/${encodeURIComponent(sectionId)}`)
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
  sessions,
  history,
  playlists,
  scanLibrary,
  libraryFilters,
  rateItem,
  hubs,
  libraryHubs,
  events,
  clearEvents,
  createCollection,
  deleteCollection,
  addCollectionItems,
  removeCollectionItem,
  updateCollection,
}

export type {
  PlexServerInfo,
  PlexLibraryStat,
  PlexRecentItem,
  PlexOnDeckItem,
  PlexPopularItem,
  PlexSession,
  PlexHistoryItem,
  PlexPlaylist,
  PlexHub,
  LibraryFilterOptions,
  PlexEvent,
}
