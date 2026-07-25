import { useServiceWorkerUpdate } from '@/shared/hooks/useServiceWorkerUpdate'

/**
 * Shows a small banner when a new service-worker version is waiting. Clicking
 * "Reload" activates the new worker and reloads the page.
 */
export function UpdateBanner() {
  const { updateReady, reload } = useServiceWorkerUpdate()

  if (!updateReady) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-100 flex items-center gap-3 bg-slate-800 border border-indigo-600 rounded-xl px-4 py-2.5 shadow-2xl"
    >
      <span className="text-sm text-slate-200">New version available</span>
      <button
        type="button"
        onClick={reload}
        className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        Reload
      </button>
    </div>
  )
}
