import type { Assignment, PlexItem } from '@/shared/types'

export type { AiLog } from '@/shared/types'

export interface AiContentAdvisorResult {
  shows: PlexItem[]
  movies: PlexItem[]
  explanation: string
}

export interface NetworkAdvisorResult {
  recommendations: Array<{
    channel_number: number
    channel_name: string
    items: Assignment[]
    reason: string
  }>
}
