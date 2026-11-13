const REQUEST_TIMEOUT = 30_000 // 30s
const AI_TIMEOUT = 300_000 // 5min for AI endpoints

function isAiPath(path: string): boolean {
  return (
    path === '/api/network/ai-advisor' ||
    path === '/api/channels/ai-suggest' ||
    path === '/api/blocks/ai-generate-day' ||
    path === '/api/ai-test' ||
    /^\/api\/channels\/\d+\/ai-content-suggestions/.test(path)
  )
}

/**
 * Ask the server whether the session is genuinely gone.
 *
 * `/api/auth/session` is public and never 401s, so this cannot recurse. On any
 * network failure it answers "not gone" — a transient blip must not log
 * somebody out.
 */
async function sessionIsGone(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session')
    if (!res.ok) return false
    return (await res.json()).authenticated === false
  } catch {
    return false
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = isAiPath(path) ? AI_TIMEOUT : REQUEST_TIMEOUT
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })

    if (res.status === 401) {
      // Confirm before tearing the app down. A 401 used to mean "session gone"
      // unconditionally, so a single unrelated 401 dropped you at the login
      // screen with a perfectly valid session — which is precisely what an
      // expired PLEX token did, because those routes forwarded Plex's 401
      // verbatim. The server no longer does that (see `_upstream_status`), and
      // asking `/api/auth/session` for a second opinion makes the UI robust to
      // any future route that gets it wrong.
      if (!(await sessionIsGone())) throw new Error('Request was not authorized')
      window.dispatchEvent(new CustomEvent('session-expired'))
      throw new Error('Session expired')
    }

    if (!res.ok) {
      let message = res.statusText
      try {
        const body = await res.json()
        const detail = body.detail ?? body.message ?? body.error
        // FastAPI validation errors return `detail` as an array of
        // {loc, msg, type} objects — flatten them to a readable string
        // instead of letting it stringify to "[object Object],...".
        if (Array.isArray(detail)) {
          message =
            detail
              .map((d) =>
                d && typeof d === 'object'
                  ? `${d.msg ?? JSON.stringify(d)}${
                      Array.isArray(d.loc)
                        ? ` (${d.loc.filter((p: unknown) => p !== 'body').join('.')})`
                        : ''
                    }`
                  : String(d),
              )
              .join('; ') || message
        } else if (typeof detail === 'string') {
          message = detail
        } else if (detail != null) {
          message = JSON.stringify(detail)
        }
      } catch {
        // response wasn't JSON
      }
      throw new Error(message)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const get = <T>(path: string) => request<T>(path)

export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export const postForm = <T>(path: string, body: Record<string, string>) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
