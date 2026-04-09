import { useEffect, type ReactNode } from 'react'

interface ModalWrapperProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function ModalWrapper({
  open,
  onClose,
  children,
  maxWidth = 'max-w-2xl',
}: ModalWrapperProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`relative w-full ${maxWidth} mx-4 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl`}>
        {children}
      </div>
    </div>
  )
}
