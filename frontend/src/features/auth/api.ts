import { post } from '@/shared/api/client'

export const authApi = {
  login: (username: string, password: string) =>
    post<{ ok: boolean }>('/api/auth/login', { username, password }),

  logout: () => post<void>('/api/auth/logout'),
}
