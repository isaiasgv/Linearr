import type { Assignment, PlexItem } from '@/shared/types'

/**
 * The one mapping from a browsed Plex item to a bulk-assign payload row.
 *
 * `POST /api/assignments/bulk` takes `{channel_number, items[]}` where each
 * item carries no channel of its own, so the row is exactly the assignment
 * minus its server-assigned fields. Duplicates are skipped server-side by the
 * `(channel_number, plex_rating_key)` uniqueness constraint — never filter
 * them out here.
 */
export type BulkAssignItem = Omit<Assignment, 'id' | 'channel_number' | 'assigned_at'>

export function toBulkAssignItem(item: PlexItem): BulkAssignItem {
  return {
    plex_rating_key: item.rating_key,
    plex_title: item.title,
    plex_type: item.type,
    plex_thumb: item.thumb,
    plex_year: item.year,
  }
}
