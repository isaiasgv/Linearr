import { del, get, post, put } from '@/shared/api/client'
import type { Watermark, WatermarkConfig } from './types'

/**
 * Every watermark write also re-syncs the channel to Tunarr, so each mutation
 * response carries the sync outcome alongside the local result. A failed sync
 * is not a failed save — the hooks surface the two separately.
 */
export interface TunarrSync {
  synced: boolean
  action?: 'updated' | 'created' | 'error'
  message?: string
  tunarr_id?: string
}

export interface WatermarkResponse {
  /** null when the channel has no watermark configured. */
  watermark: Watermark | null
}

export interface SaveWatermarkResponse {
  ok: boolean
  watermark: WatermarkConfig
  tunarr_sync: TunarrSync
}

export interface DeleteWatermarkResponse {
  ok: boolean
  tunarr_sync: TunarrSync
}

export interface WatermarkImageResponse {
  ok: boolean
  image_url: string
  tunarr_sync: TunarrSync
}

function getWatermark(channelNumber: number): Promise<WatermarkResponse> {
  return get<WatermarkResponse>(`/api/channels/${channelNumber}/watermark`)
}

function saveWatermark(channelNumber: number, data: Watermark): Promise<SaveWatermarkResponse> {
  // `image_url` is server-owned (set through the image route below), so strip
  // it rather than echoing a read-only field back into the config blob.
  const { image_url: _serverOwned, ...config } = data
  return put<SaveWatermarkResponse>(`/api/channels/${channelNumber}/watermark`, config)
}

function deleteWatermark(channelNumber: number): Promise<DeleteWatermarkResponse> {
  return del<DeleteWatermarkResponse>(`/api/channels/${channelNumber}/watermark`)
}

/**
 * Resolve the image Tunarr will fetch.
 *
 * `{ url }` is stored verbatim and must be absolute; `{ image }` is a data URI
 * that gets uploaded to Tunarr; `{}` falls back to the channel's own icon
 * (also uploaded, since icons are stored as data URIs and ffmpeg cannot read
 * a `data:` input).
 */
function setWatermarkImage(
  channelNumber: number,
  payload: { image?: string; url?: string },
): Promise<WatermarkImageResponse> {
  return post<WatermarkImageResponse>(`/api/channels/${channelNumber}/watermark/image`, payload)
}

export const watermarkApi = {
  getWatermark,
  saveWatermark,
  deleteWatermark,
  setWatermarkImage,
}
