import { forwardRef, type HTMLAttributes } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** base = slate-900 (on the app shell), raised = slate-800 (nested on a base card) */
  level?: 'base' | 'raised'
  /** Hover border highlight for clickable/selectable cards */
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md'
}

const LEVEL_CLASSES = {
  base: 'bg-slate-900 border-slate-700',
  raised: 'bg-slate-800 border-slate-700',
} as const

const PADDING_CLASSES = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
} as const

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { level = 'base', interactive = false, padding = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`border rounded-xl ${LEVEL_CLASSES[level]} ${PADDING_CLASSES[padding]} ${
        interactive ? 'hover:border-slate-600 transition-colors' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
})
