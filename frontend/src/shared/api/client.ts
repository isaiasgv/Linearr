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
      window.dispatchEvent(new CustomEvent('session-expired'))
      throw new Error('Session expired')
    }

    if (!res.ok) {
      let message = res.statusText
      try {
        const body = await res.json()
        message = body.detail || body.message || body.error || message
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
