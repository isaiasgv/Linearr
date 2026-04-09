import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from './api'
import { useAuthStore } from './store'

export function useLogin() {
  const { setLoggedIn, setLoginError } = useAuthStore()

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: () => setLoggedIn(true),
    onError: (err: Error) => setLoginError(err.message),
  })
}

export function useLogout() {
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn)
  const qc = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      setLoggedIn(false)
      qc.clear()
    },
  })
}
