import type { Channel } from '@/shared/types'

/** Solid tier-colored background for channel-number chips (sidebar list, detail header). */
export function tierNumberColor(tier: Channel['tier']): string {
  switch (tier) {
    case 'Galaxy Main':
      return 'bg-blue-700 text-blue-100'
    case 'Classics':
      return 'bg-purple-700 text-purple-100'
    case 'Galaxy Premium':
      return 'bg-amber-700 text-amber-100'
  }
}
