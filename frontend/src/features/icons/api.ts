import { get, post, put, del } from '@/shared/api/client'

export interface SavedIcon {
  id: number
  name: string
  category: string
  data: string
  composition?: string | null
  created_at: string
}

function listIcons(): Promise<SavedIcon[]> {
  return get<SavedIcon[]>('/api/icons/library')
}

interface SaveIconBody {
  name: string
  category: string
  data: string
  composition?: unknown
}

function saveIcon(body: SaveIconBody): Promise<SavedIcon> {
  return post<SavedIcon>('/api/icons/library', body)
}

function updateIcon(
  id: number,
  body: Partial<SaveIconBody> & { composition?: unknown },
): Promise<SavedIcon> {
  return put<SavedIcon>(`/api/icons/library/${id}`, body)
}

function deleteIcon(id: number): Promise<void> {
  return del<void>(`/api/icons/library/${id}`)
}

function assignToChannel(channelNumber: number, iconData: string): Promise<{ ok: boolean }> {
  // The backend registers PUT (and DELETE) for this path — a POST is a 405.
  return put<{ ok: boolean }>(`/api/channels/${channelNumber}/icon`, { icon: iconData })
}

function seedPack(pack: {
  icons: Array<{ name: string; category: string; data: string; channel?: string | null }>
}): Promise<{ ok: boolean; created: number; assigned: number }> {
  return post<{ ok: boolean; created: number; assigned: number }>('/api/icons/library/seed', pack)
}

function importFromTunarr(): Promise<{ ok: boolean; imported: number; assigned: number }> {
  return post<{ ok: boolean; imported: number; assigned: number }>('/api/icons/import-from-tunarr')
}

/**
 * The channel icon, and the URL Tunarr is given for it.
 *
 * Two different things: `icon` is the data URI Linearr renders itself, while
 * `icon_url` is the absolute HTTP URL Tunarr publishes in the guide and Plex
 * clients fetch. `manual` means it was set by hand and will not be re-derived.
 */
export interface ChannelIcon {
  icon: string | null
  icon_url: string | null
  manual: boolean
}

function getChannelIcon(channelNumber: number): Promise<ChannelIcon> {
  return get<ChannelIcon>(`/api/channels/${channelNumber}/icon`)
}

/** `{url}` to set one verbatim, `{image}` to upload bytes, `{}` to re-derive. */
function setChannelIconImage(
  channelNumber: number,
  body: { url?: string; image?: string },
): Promise<{ ok: boolean; icon_url: string; manual: boolean }> {
  return post(`/api/channels/${channelNumber}/icon/image`, body)
}

export const iconsApi = {
  listIcons,
  saveIcon,
  updateIcon,
  deleteIcon,
  assignToChannel,
  seedPack,
  importFromTunarr,
  getChannelIcon,
  setChannelIconImage,
}
