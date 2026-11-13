import { get, post, put, del } from '@/shared/api/client'
import type { Channel } from '@/shared/types'
import type {
  ChannelDeleteTunarrResult,
  ChannelReorderRequest,
  ChannelReorderResult,
} from './types'

export const channelsApi = {
  list: () => get<Channel[]>('/api/channels'),

  create: (data: Partial<Channel>) => post<Channel>('/api/channels', data),

  update: (number: number, data: Partial<Channel>) => put<Channel>(`/api/channels/${number}`, data),

  /**
   * Deletes the channel AND, by default, the Tunarr channel linked to it.
   * `tunarr` is null when there was no link; otherwise it reports whether the
   * Tunarr side succeeded — Linearr's own delete has already committed either
   * way, so a failure there means a stranded Tunarr channel, not a rollback.
   */
  remove: (number: number) =>
    del<{ ok: boolean; tunarr: ChannelDeleteTunarrResult | null }>(`/api/channels/${number}`),

  /**
   * Drag-and-drop reorder. `target_index` is the index the moved channel should
   * occupy in the **resulting** lineup (see `channelDropTargetIndex`). The
   * response's `channels` array is the authoritative new lineup.
   */
  reorder: (body: ChannelReorderRequest) =>
    post<ChannelReorderResult>('/api/channels/reorder', body),
}
