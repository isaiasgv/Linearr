import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { INPUT_CLASSES, inputBorderClass } from './inputStyles'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Red border + aria-invalid for validation errors */
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${INPUT_CLASSES} ${inputBorderClass(invalid)} ${className}`}
      {...rest}
    />
  )
})
