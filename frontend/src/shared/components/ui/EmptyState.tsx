import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** Optional icon (usually an inline SVG) rendered above the title */
  icon?: ReactNode
  title: string
  description?: string
  /** Optional call-to-action, e.g. a <Button> */
  action?: ReactNode
  className?: string
}

/** Centered placeholder for empty lists / no-results / not-configured states. */
export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
    >
      {icon && <div className="mb-3 text-slate-600">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
