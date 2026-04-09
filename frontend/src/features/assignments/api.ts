import { get, post, del } from '@/shared/api/client'
import type { Assignment, AssignmentsMap } from '@/shared/types'

export const assignmentsApi = {
  list: () => get<AssignmentsMap>('/api/assignments'),

  assign: (data: {
    channel_number: number
    plex_rating_key: string
    plex_title: string
    plex_type: 'show' | 'movie'
    plex_thumb: string | null
    plex_year: number | null
  }) => post<Assignment>('/api/assignments', data),

  bulkAssign: (
    channel_number: number,
    items: Omit<Assignment, 'id' | 'channel_number' | 'assigned_at'>[],
  ) =>
    post<{ added: number; skipped: number }>('/api/assignments/bulk', {
      channel_number,
      items,
    }),

  unassign: (id: number) => del<void>(`/api/assignments/${id}`),
}
