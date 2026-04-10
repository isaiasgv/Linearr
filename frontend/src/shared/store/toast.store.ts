import { create } from 'zustand'
import Swal from 'sweetalert2'

const Toast = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 4000,
  timerProgressBar: true,
  background: '#1e293b',
  color: '#e2e8f0',
  customClass: {
    popup: 'swal-toast-popup',
  },
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer
    toast.onmouseleave = Swal.resumeTimer
  },
})

interface ToastState {
  toasts: never[]
  addToast: (message: string, isError?: boolean) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>(() => ({
  toasts: [],

  addToast: (message, isError = false) => {
    Toast.fire({
      icon: isError ? 'error' : 'success',
      title: message,
    })
  },

  removeToast: () => {},
}))
