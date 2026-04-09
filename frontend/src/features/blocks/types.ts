export type { Block, BlockSlot } from '@/shared/types'

export interface BlockPreset {
  label: string
  name: string
  start_time: string
  end_time: string
  days: string[]
  content_type: 'shows' | 'movies' | 'both'
}

export const BLOCK_PRESETS: BlockPreset[] = [
  { label: 'Morning', name: 'Morning', start_time: '06:00', end_time: '12:00', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], content_type: 'shows' },
  { label: 'Daytime', name: 'Daytime', start_time: '12:00', end_time: '16:00', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], content_type: 'both' },
  { label: 'After School', name: 'After School', start_time: '15:00', end_time: '19:00', days: ['Mon','Tue','Wed','Thu','Fri'], content_type: 'shows' },
  { label: 'Primetime', name: 'Primetime', start_time: '20:00', end_time: '23:00', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], content_type: 'both' },
  { label: 'Late Night', name: 'Late Night', start_time: '23:00', end_time: '02:00', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], content_type: 'movies' },
  { label: 'Weekend', name: 'Weekend', start_time: '10:00', end_time: '22:00', days: ['Sat','Sun'], content_type: 'both' },
]

export const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
