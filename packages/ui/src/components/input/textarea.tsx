import { useId } from 'react'
import type { ReactElement, TextareaHTMLAttributes } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { FieldError } from './field-error.js'
import { getFieldControlClassName, getFieldDescribedBy } from './field-shared.js'
import './input.css'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly label: string
  /** Текст ошибки ПОД полем (иконка + текст, `error`-слот, `SRS-UX-019`), см. `input.tsx`. */
  readonly error?: string
  readonly id?: string
}

/** Многострочный текстовый ввод — тот же контракт `label`/`error`, что и `Input` (`SRS-UX-021`). */
export const Textarea = ({
  label,
  error,
  id,
  className,
  ...rest
}: TextareaProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const errorId = error !== undefined ? `${fieldId}-error` : undefined

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        {...rest}
        id={fieldId}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={getFieldDescribedBy(errorId, rest['aria-describedby'])}
        className={cx(
          getFieldControlClassName('ui-field__control', error !== undefined, className),
          'ui-field__textarea',
          !prefersReducedMotion && 'ui-field__control--motion',
        )}
      />
      {error !== undefined ? <FieldError id={errorId ?? `${fieldId}-error`} message={error} /> : null}
    </div>
  )
}
