import { post } from '@/shared/api/client'

export const authApi = {
  /**
   * `remember` picks the cookie lifetime: 90 days when set, 7 otherwise. Both
   * slide — the server re-issues the cookie as you use the app — so the number
   * is "since you last used it", not "since you logged in".
   */
  login: (username: string, password: string, remember = true) =>
    post<{ ok: boolean; expires_in: number }>('/api/auth/login', {
      username,
      password,
      remember,
    }),

  logout: () => post<void>('/api/auth/logout'),
}
