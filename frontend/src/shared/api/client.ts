const REQUEST_TIMEOUT = 30_000 // 30s

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

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
