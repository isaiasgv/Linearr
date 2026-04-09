import { get, post, put, del } from '@/shared/api/client'
import type { Channel } from '@/shared/types'

export const channelsApi = {
  list: () => get<Channel[]>('/api/channels'),

  create: (data: Partial<Channel>) => post<Channel>('/api/channels', data),

  update: (number: number, data: Partial<Channel>) =>
    put<Channel>(`/api/channels/${number}`, data),

  remove: (number: number) => del<void>(`/api/channels/${number}`),

}
