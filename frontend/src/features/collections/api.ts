import { del, get, post, put } from '@/shared/api/client'
import type {
  ChannelCollection,
  CollectionStatus,
  SmartCollectionInput,
  SmartCollectionUpdateInput,
} from '@/shared/types'

function getCollectionStatus(channelNumber: number): Promise<CollectionStatus> {
  return get<CollectionStatus>(`/api/collections/status/${channelNumber}`)
}

interface GenerateCollectionsResult {
  movie?: { name: string; created: boolean; added: number; removed: number; total: number }
  show?: { name: string; created: boolean; added: number; removed: number; total: number }
  tunarr?: { synced: boolean; error: string | null }
}

function generateCollections(channelNumber: number): Promise<GenerateCollectionsResult> {
  return post<GenerateCollectionsResult>(`/api/collections/generate/${channelNumber}`)
}

function getChannelCollections(
  channelNumber: number,
): Promise<{ movie?: ChannelCollection; show?: ChannelCollection }> {
  return get<{ movie?: ChannelCollection; show?: ChannelCollection }>(
    `/api/channel-collections/${channelNumber}`,
  )
}

function unlinkCollection(channelNumber: number, plexType: 'movie' | 'show'): Promise<void> {
  return del<void>(`/api/channel-collections/${channelNumber}/${plexType}`)
}

// ── Assign an existing collection, by reference ──────────────────────────────

export interface AssignCollectionBody {
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
  is_smart: boolean
}

export interface AssignCollectionResult {
  ok: boolean
  channel_number: number
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
  source: 'assigned'
  is_smart: number
}

/**
 * Point a channel's (type) slot at an EXISTING Plex collection.
 *
 * Reference only — the backend makes no Plex call at all: the collection's
 * items are never read, copied into assignments, or modified. Contrast
 * `POST /api/channel-collections/{n}` (the "import items" action), which copies
 * a collection's items into the channel's assignments.
 */
function assignCollection(
  channelNumber: number,
  body: AssignCollectionBody,
): Promise<AssignCollectionResult> {
  return post<AssignCollectionResult>(`/api/channel-collections/${channelNumber}/assign`, body)
}

// ── Plex smart collections ───────────────────────────────────────────────────

export interface CreateSmartCollectionResult {
  rating_key: string
  title: string
  type: 'movie' | 'show'
  smart: boolean
  /** Genre names that matched nothing in the picked library — created anyway. */
  unresolved_genres: string[]
  assigned: boolean
  channel_number: number
  plex_type: 'movie' | 'show'
  source: 'assigned'
  is_smart: number
}

/** Create a Plex smart collection AND assign it to the channel, atomically. */
function createSmartCollectionForChannel(
  channelNumber: number,
  body: SmartCollectionInput,
): Promise<CreateSmartCollectionResult> {
  return post<CreateSmartCollectionResult>(`/api/channels/${channelNumber}/smart-collection`, body)
}

export interface UpdateSmartCollectionResult {
  ok: boolean
  updated: string[]
  unresolved_genres: string[]
}

/** Replace a smart collection's filter rules and/or rename it. */
function updateSmartCollection(
  ratingKey: string,
  body: SmartCollectionUpdateInput,
): Promise<UpdateSmartCollectionResult> {
  return put<UpdateSmartCollectionResult>(
    `/api/plex/smart-collections/${encodeURIComponent(ratingKey)}`,
    body,
  )
}

/**
 * Delete the actual collection in Plex. The backend also clears every
 * `channel_collections` row referencing it — destructive, unlike unassign,
 * which only drops the link.
 */
function deletePlexCollection(ratingKey: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/plex/collections/${encodeURIComponent(ratingKey)}`)
}

export const collectionsApi = {
  getCollectionStatus,
  generateCollections,
  getChannelCollections,
  unlinkCollection,
  assignCollection,
  createSmartCollectionForChannel,
  updateSmartCollection,
  deletePlexCollection,
}
