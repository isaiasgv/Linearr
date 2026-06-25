import { useEffect, useState } from 'react'

/**
 * Registers the service worker and detects when a new version is waiting to
 * activate. Returns `updateReady` (true when a waiting worker exists) and a
 * `reload()` that tells the waiting worker to take over, then reloads once the
 * new worker has claimed the page (via the `controllerchange` event).
 *
 * Registration lives here (not inline in index.html) so we own the single
 * registration and can observe `updatefound` / `registration.waiting`.
 */
export function useServiceWorkerUpdate() {
  const [updateReady, setUpdateReady] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let reloading = false
    const promote = (worker: ServiceWorker | null) => {
      if (!worker) return
      setWaitingWorker(worker)
      setUpdateReady(true)
    }

    const onControllerChange = () => {
      // The new SW has taken control — reload once to pick up fresh assets.
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')

        // A worker may already be waiting (installed during a previous visit).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promote(registration.waiting)
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            // "installed" + an existing controller => a new version is waiting.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promote(registration.waiting ?? installing)
            }
          })
        })
      } catch {
        /* registration failures are non-fatal */
      }
    }

    if (document.readyState === 'complete') {
      void register()
    } else {
      window.addEventListener('load', register, { once: true })
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  const reload = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    } else {
      window.location.reload()
    }
  }

  return { updateReady, reload }
}
