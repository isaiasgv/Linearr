/** Canonical form-control recipe shared by Input, Select, and Textarea. */
export const INPUT_CLASSES =
  'w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed'

export function inputBorderClass(invalid: boolean): string {
  return invalid ? 'border-red-500' : 'border-slate-700 focus:border-indigo-500'
}
