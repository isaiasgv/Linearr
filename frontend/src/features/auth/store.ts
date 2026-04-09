import { create } from 'zustand'

interface AuthState {
  isLoggedIn: boolean
  loginError: string | null
  setLoggedIn: (v: boolean) => void
  setLoginError: (msg: string | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: true,
  loginError: null,
  setLoggedIn: (isLoggedIn) => set({ isLoggedIn, loginError: null }),
  setLoginError: (loginError) => set({ loginError }),
}))
