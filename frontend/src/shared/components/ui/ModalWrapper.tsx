import { useEffect, useRef, type ReactNode } from 'react'

interface ModalWrapperProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
  /** id of the element (usually the dialog title) that labels this dialog */
  titleId?: string
  /** fallback accessible name when there is no visible title to reference */
  ariaLabel?: string
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ModalWrapper({
  open,
  onClose,
  children,
  maxWidth = 'max-w-2xl',
  titleId,
  ariaLabel,
}: ModalWrapperProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Escape to close + focus trap (Tab / Shift+Tab cycle within the dialog)
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusable.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Move focus into the dialog on open; restore it to the trigger on close
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (dialog) {
      const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(focusable ?? dialog).focus()
    }

    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel}
        tabIndex={-1}
        className={`relative w-full ${maxWidth} mx-4 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl focus:outline-none`}
      >
        {children}
      </div>
    </div>
  )
}
