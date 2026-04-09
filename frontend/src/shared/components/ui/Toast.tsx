import { useToastStore } from '@/shared/store/toast.store'

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => removeToast(t.id)}
          className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg cursor-pointer transition-all ${
            t.isError
              ? 'bg-red-900 border border-red-700 text-red-100'
              : 'bg-slate-800 border border-slate-600 text-slate-100'
          }`}
        >
          {t.isError ? (
            <span className="text-red-400">✕</span>
          ) : (
            <span className="text-green-400">✓</span>
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
