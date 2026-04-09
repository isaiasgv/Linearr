import { del, get, post, put } from '@/shared/api/client'
import type {
  SmartCollection,
  TunarrChannel,
  TunarrChannelLink,
  TunarrCollectionLink,
  TunarrScheduleItem,
} from '@/shared/types'

function getChannels(): Promise<TunarrChannel[]> {
  return get<TunarrChannel[]>('/api/tunarr/channels')
}

function getChannelLinks(): Promise<TunarrChannelLink[]> {
  return get<TunarrChannelLink[]>('/api/tunarr/channel-links')
}

interface CreateChannelBody {
  name: string
  number: number
  icon?: string
}

function createChannel(body: CreateChannelBody): Promise<TunarrChannel> {
  return post<TunarrChannel>('/api/tunarr/channels', body)
}

interface LinkChannelBody {
  channel_number: number
  tunarr_id: string
}

function linkChannel(body: LinkChannelBody): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/api/tunarr/channel-links', body)
}

function unlinkChannel(channelNumber: number): Promise<void> {
  return del<void>(`/api/tunarr/channel-links/${channelNumber}`)
}

function getCollectionLinks(): Promise<TunarrCollectionLink[]> {
  return get<TunarrCollectionLink[]>('/api/tunarr/collection-links')
}

interface LinkCollectionBody {
  channel_number: number
  plex_type: 'movie' | 'show'
  tunarr_collection_id: string
  tunarr_collection_name: string
}

function linkCollection(body: LinkCollectionBody): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/api/tunarr/collection-links', body)
}

function unlinkCollection(channelNumber: number, plexType: string): Promise<void> {
  return del<void>(`/api/tunarr/collection-links/${channelNumber}/${plexType}`)
}

function testConnection(tunarr_url: string): Promise<{
  ok: boolean
  latency_ms?: number
  url?: string
  version?: string
  channels?: number
}> {
  return post<{
    ok: boolean
    latency_ms?: number
    url?: string
    version?: string
    channels?: number
  }>('/api/tunarr/test', { url: tunarr_url })
}

interface VersionCheck {
  version: string | null
  supported_version: string
  is_supported: boolean | null
  tunarr_url: string
}

function getVersionCheck(): Promise<VersionCheck> {
  return get<VersionCheck>('/api/tunarr/version-check')
}

function getChannelSchedule(tunarrId: string): Promise<TunarrScheduleItem[]> {
  return get<TunarrScheduleItem[]>(`/api/tunarr/channels/${encodeURIComponent(tunarrId)}/schedule`)
}

function getChannelDetail(tunarrId: string): Promise<TunarrChannel> {
  return get<TunarrChannel>(`/api/tunarr/channels/${encodeURIComponent(tunarrId)}/detail`)
}

function getChannelShows(tunarrId: string): Promise<unknown[]> {
  return get<unknown[]>(`/api/tunarr/channels/${encodeURIComponent(tunarrId)}/shows`)
}

function runUpdateXmlTvTask(): Promise<void> {
  return post<void>('/api/tunarr/tasks/UpdateXmlTvTask')
}

function runScanLibrariesTask(): Promise<void> {
  return post<void>('/api/tunarr/tasks/ScanLibrariesTask')
}

function getSmartCollections(): Promise<SmartCollection[]> {
  return get<SmartCollection[]>('/api/tunarr/smart-collections')
}

function updateSmartCollection(
  uuid: string,
  body: Partial<SmartCollection>,
): Promise<SmartCollection> {
  return put<SmartCollection>(`/api/tunarr/smart-collections/${encodeURIComponent(uuid)}`, body)
}

function deleteSmartCollection(uuid: string): Promise<void> {
  return del<void>(`/api/tunarr/smart-collections/${encodeURIComponent(uuid)}`)
}

function syncCollections(channelNumber: number): Promise<{ created: string[]; updated: string[] }> {
  return post<{ created: string[]; updated: string[] }>(
    `/api/tunarr/channel-links/${channelNumber}/sync-collections`,
  )
}

interface PushScheduleBody {
  preview?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushSchedule(channelNumber: number, body?: PushScheduleBody): Promise<any> {
  return post(`/api/tunarr/channel-links/${channelNumber}/push-schedule`, body)
}

interface GuideChannel {
  channel_number: number
  tunarr_id: string
  tunarr_name: string
  tunarr_number: number | null
  schedule: Array<{
    startTime: string
    duration: number
    type: string
    title: string
    episode?: { title?: string; season?: number; episode?: number }
  }>
}

function getGuide(hours = 24): Promise<{ channels: GuideChannel[] }> {
  return get<{ channels: GuideChannel[] }>(`/api/tunarr/guide?hours=${hours}`)
}

export const tunarrApi = {
  getChannels,
  getChannelLinks,
  createChannel,
  linkChannel,
  unlinkChannel,
  getCollectionLinks,
  linkCollection,
  unlinkCollection,
  testConnection,
  getVersionCheck,
  getChannelSchedule,
  getChannelDetail,
  runUpdateXmlTvTask,
  runScanLibrariesTask,
  getChannelShows,
  getSmartCollections,
  updateSmartCollection,
  deleteSmartCollection,
  syncCollections,
  pushSchedule,
  getGuide,
}

export type { GuideChannel, VersionCheck }
