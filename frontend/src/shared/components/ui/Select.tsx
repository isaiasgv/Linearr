import { forwardRef, type SelectHTMLAttributes } from 'react'
import { INPUT_CLASSES, inputBorderClass } from './inputStyles'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Red border + aria-invalid for validation errors */
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = '', children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${INPUT_CLASSES} ${inputBorderClass(invalid)} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
})
