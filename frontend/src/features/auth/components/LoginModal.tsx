import { useId, useState, type FormEvent } from 'react'
import { useLogin } from '../hooks'
import { Spinner } from '@/shared/components/ui/Spinner'
import { Logo } from '@/shared/components/ui/Logo'

/** Mirrors SESSION_MAX_AGE / SESSION_REMEMBER_MAX_AGE in `main.py`. */
const REMEMBER_DAYS = 90
const DEFAULT_DAYS = 7
const REMEMBER_KEY = 'linearr:rememberMe'

export function LoginModal() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // Persisted so the box comes back the way it was left. Defaults on: this is a
  // self-hosted app on your own network, and the failure people actually hit is
  // being logged out.
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const login = useLogin()
  const usernameId = useId()
  const passwordId = useId()
  const rememberId = useId()

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    try {
      localStorage.setItem(REMEMBER_KEY, String(remember))
    } catch {
      /* private mode — the choice just won't persist */
    }
    login.mutate({ username, password, remember })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <Logo size={40} />
          <div>
            <h1 className="text-lg font-bold">Linearr</h1>
            <p className="text-xs text-slate-500">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor={usernameId} className="block text-xs text-slate-400 mb-1">
              Username
            </label>
            <input
              id={usernameId}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label htmlFor={passwordId} className="block text-xs text-slate-400 mb-1">
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor={rememberId}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"
            >
              <input
                id={rememberId}
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Keep me signed in
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Stays signed in for {remember ? REMEMBER_DAYS : DEFAULT_DAYS} days since you last used
              Linearr — not since you signed in, so regular use never logs you out.
            </p>
          </div>

          {login.error && (
            <p
              role="alert"
              className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2"
            >
              {login.error.message}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition flex items-center justify-center gap-2"
          >
            {login.isPending && <Spinner size="sm" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
