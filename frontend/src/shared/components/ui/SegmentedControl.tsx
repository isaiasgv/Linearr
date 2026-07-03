export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  /** brand = indigo active segment, neutral = slate active segment */
  tone?: 'brand' | 'neutral'
  className?: string
}

const ACTIVE_CLASSES = {
  brand: 'bg-indigo-600 text-white',
  neutral: 'bg-slate-700 text-slate-100',
} as const

/** Small inline toggle group (view modes, type filters). Real buttons — keyboard accessible. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  tone = 'brand',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div className={`inline-flex items-center bg-slate-800/60 rounded-lg p-0.5 ${className}`}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              active ? ACTIVE_CLASSES[tone] : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
