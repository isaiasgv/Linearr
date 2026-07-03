import Swal from 'sweetalert2'

export interface ConfirmDialogOptions {
  title: string
  text?: string
  /** Confirm button label (default "Confirm", or "Delete" when danger) */
  confirmText?: string
  /** Red confirm button for destructive actions */
  danger?: boolean
}

/**
 * Dark-themed SweetAlert2 confirm — matches the existing swal styling used
 * across the app (e.g. CablePlexView). Resolves true when confirmed.
 *
 *   if (await confirmDialog({ title: 'Delete block?', danger: true })) { ... }
 */
export async function confirmDialog({
  title,
  text,
  confirmText,
  danger = false,
}: ConfirmDialogOptions): Promise<boolean> {
  const { isConfirmed } = await Swal.fire({
    title,
    text,
    icon: danger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: confirmText ?? (danger ? 'Delete' : 'Confirm'),
    cancelButtonText: 'Cancel',
    background: '#1e293b',
    color: '#e2e8f0',
    confirmButtonColor: danger ? '#dc2626' : '#4f46e5',
  })
  return isConfirmed
}
