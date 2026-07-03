export type StatusDotState = 'ok' | 'error' | 'warn' | 'unknown'

export interface StatusDotProps {
  state: StatusDotState
  /** Optional text rendered next to the dot */
  label?: string
  /** Pulse animation on the ok state (default true) */
  pulse?: boolean
  className?: string
}

const STATE_CLASSES: Record<StatusDotState, string> = {
  ok: 'bg-emerald-400',
  error: 'bg-red-400',
  warn: 'bg-amber-400',
  unknown: 'bg-slate-500',
}

const STATE_TEXT: Record<StatusDotState, string> = {
  ok: 'text-emerald-400',
  error: 'text-red-400',
  warn: 'text-amber-400',
  unknown: 'text-slate-500',
}

/** Connection/health indicator dot with optional label. */
export function StatusDot({ state, label, pulse = true, className = '' }: StatusDotProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex w-2 h-2" aria-hidden="true">
        {state === 'ok' && pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${STATE_CLASSES[state]}`} />
      </span>
      {label && <span className={`text-xs ${STATE_TEXT[state]}`}>{label}</span>}
    </span>
  )
}
