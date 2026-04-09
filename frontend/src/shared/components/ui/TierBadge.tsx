import type { Channel } from '@/shared/types'

export function tierColor(tier: Channel['tier']): string {
  switch (tier) {
    case 'Galaxy Main':
      return 'bg-blue-900/40 text-blue-300 border-blue-700'
    case 'Classics':
      return 'bg-purple-900/40 text-purple-300 border-purple-700'
    case 'Galaxy Premium':
      return 'bg-amber-900/40 text-amber-300 border-amber-700'
  }
}

interface TierBadgeProps {
  tier: Channel['tier']
}

export function TierBadge({ tier }: TierBadgeProps) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${tierColor(tier)}`}>
      {tier}
    </span>
  )
}
