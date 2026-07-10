import { forwardRef, type ButtonHTMLAttributes } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — rendered as aria-label and title. Required for icon-only buttons. */
  label: string
  variant?: 'ghost' | 'danger'
}

const VARIANT_CLASSES: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost: 'text-slate-400 hover:text-slate-100 hover:bg-slate-800',
  danger: 'text-slate-400 hover:text-red-400 hover:bg-red-900/30',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center p-2 rounded-lg transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
