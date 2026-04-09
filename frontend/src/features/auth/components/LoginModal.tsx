import { useState, type FormEvent } from 'react'
import { useLogin } from '../hooks'
import { Spinner } from '@/shared/components/ui/Spinner'
import { Logo } from '@/shared/components/ui/Logo'

export function LoginModal() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ username, password })
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
            <label className="block text-xs text-slate-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {login.error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
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
