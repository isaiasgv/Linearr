import { get, post, put, del } from '@/shared/api/client'

export interface SavedIcon {
  id: number
  name: string
  category: string
  data: string
  created_at: string
}

function listIcons(): Promise<SavedIcon[]> {
  return get<SavedIcon[]>('/api/icons/library')
}

function saveIcon(body: { name: string; category: string; data: string }): Promise<SavedIcon> {
  return post<SavedIcon>('/api/icons/library', body)
}

function updateIcon(id: number, body: Partial<{ name: string; category: string; data: string }>): Promise<SavedIcon> {
  return put<SavedIcon>(`/api/icons/library/${id}`, body)
}

function deleteIcon(id: number): Promise<void> {
  return del<void>(`/api/icons/library/${id}`)
}

function assignToChannel(channelNumber: number, iconData: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/channels/${channelNumber}/icon`, { icon: iconData })
}

function seedPack(pack: { icons: Array<{ name: string; category: string; data: string; channel?: string | null }> }): Promise<{ ok: boolean; created: number; assigned: number }> {
  return post<{ ok: boolean; created: number; assigned: number }>('/api/icons/library/seed', pack)
}

function importFromTunarr(): Promise<{ ok: boolean; imported: number; assigned: number }> {
  return post<{ ok: boolean; imported: number; assigned: number }>('/api/icons/import-from-tunarr')
}

export const iconsApi = { listIcons, saveIcon, updateIcon, deleteIcon, assignToChannel, seedPack, importFromTunarr }
