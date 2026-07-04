const CACHE = 'linearr-v2'
const THUMB_CACHE = 'linearr-thumbs-v1'
const THUMB_CACHE_MAX = 400

// Do NOT skipWaiting here: a freshly installed SW should enter the "waiting"
// state so the app can surface an "update available" prompt. The page tells us
// to activate via a SKIP_WAITING message (see below).
self.addEventListener('install', () => {})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k !== THUMB_CACHE).map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

// Trim oldest entries once the thumb cache exceeds its cap (cache.keys()
// returns entries in insertion order, so this is FIFO — good enough here).
async function trimThumbCache() {
  const cache = await caches.open(THUMB_CACHE)
  const keys = await cache.keys()
  if (keys.length > THUMB_CACHE_MAX) {
    await Promise.all(keys.slice(0, keys.length - THUMB_CACHE_MAX).map((k) => cache.delete(k)))
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return

  // Poster thumbnails: cache-first. They're immutable (the backend serves
  // long-lived Cache-Control) and by far the heaviest part of navigation —
  // serving repeats from the SW cache makes view switches feel instant.
  if (e.request.url.includes('/api/plex/thumb')) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const clone = res.clone()
              caches
                .open(THUMB_CACHE)
                .then((c) => c.put(e.request, clone))
                .then(trimThumbCache)
            }
            return res
          }),
      ),
    )
    return
  }

  if (e.request.url.includes('/api/')) return

  // Navigation requests (HTML): network-first so deploys are picked up immediately
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, clone))
          }
          return res
        })
        .catch(() => caches.match(e.request)),
    )
    return
  }

  // Assets (JS, CSS, images): stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, clone))
        }
        return res
      })
      return cached || fetchPromise
    }),
  )
})
