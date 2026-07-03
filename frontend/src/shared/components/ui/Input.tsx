import { forwardRef, type InputHTMLAttributes } from 'react'
import { INPUT_CLASSES, inputBorderClass } from './inputStyles'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Red border + aria-invalid for validation errors */
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${INPUT_CLASSES} ${inputBorderClass(invalid)} ${className}`}
      {...rest}
    />
  )
})
