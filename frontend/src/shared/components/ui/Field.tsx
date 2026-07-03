import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

export interface FieldProps {
  label: string
  /** Muted helper text shown below the control (hidden while an error is shown) */
  hint?: string
  /** Validation error shown below the control */
  error?: string
  children: ReactNode
}

/**
 * Labelled form field. Wires label htmlFor ↔ control id via useId by cloning
 * the child with an `id` (an existing id on the child wins).
 *
 *   <Field label="Plex URL" error={errors.url}>
 *     <Input value={url} onChange={...} invalid={!!errors.url} />
 *   </Field>
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const generatedId = useId()

  let control = children
  let controlId: string | undefined
  if (isValidElement(children)) {
    const child = children as ReactElement<{ id?: string }>
    controlId = child.props.id ?? generatedId
    control = cloneElement(child, { id: controlId })
  }

  return (
    <div>
      <label htmlFor={controlId} className="block text-xs font-medium text-slate-400 mb-1">
        {label}
      </label>
      {control}
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}
