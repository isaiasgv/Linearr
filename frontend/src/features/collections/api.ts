import { del, get, post } from '@/shared/api/client'
import type { ChannelCollection, CollectionStatus } from '@/shared/types'

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

interface LinkCollectionBody {
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
}

function linkCollection(
  channelNumber: number,
  body: LinkCollectionBody,
): Promise<ChannelCollection> {
  return post<ChannelCollection>(`/api/channel-collections/${channelNumber}`, body)
}

function unlinkCollection(
  channelNumber: number,
  plexType: 'movie' | 'show',
): Promise<void> {
  return del<void>(`/api/channel-collections/${channelNumber}/${plexType}`)
}

export const collectionsApi = {
  getCollectionStatus,
  generateCollections,
  getChannelCollections,
  linkCollection,
  unlinkCollection,
}
