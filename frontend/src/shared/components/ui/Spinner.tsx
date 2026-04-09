interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const sizeClass = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }[size]
  return (
    <div
      className={`${sizeClass} animate-spin rounded-full border-2 border-slate-600 border-t-blue-400 ${className}`}
    />
  )
}
