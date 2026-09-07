import { useId } from 'react'
import type { InputHTMLAttributes, ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { FieldError } from './field-error.js'
import { getFieldControlClassName, getFieldDescribedBy } from './field-shared.js'
import './input.css'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Текст `<label>`, связывается с полем через `htmlFor`/`id` — НЕ полагается на `placeholder`
   * как единственную подсказку (`SRS-UX-034` «Форма»). */
  readonly label: string
  /** Текст ошибки ПОД полем (иконка + текст, `error`-слот, `SRS-UX-019`). Наличие пропа выставляет
   * `aria-invalid="true"` и `aria-describedby`, указывающий на элемент с этим текстом (AC3). */
  readonly error?: string
  readonly id?: string
}

/**
 * Текстовое поле ввода (`SRS-UX-021`). Полностью управляемый компонент — не мутирует `value`
 * самостоятельно, значение и его изменение целиком в руках потребителя (`onChange`/`value`).
 */
export const Input = ({
  label,
  error,
  id,
  className,
  ...rest
}: InputProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const errorId = error !== undefined ? `${fieldId}-error` : undefined

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        {...rest}
        id={fieldId}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={getFieldDescribedBy(errorId, rest['aria-describedby'])}
        className={cx(
          getFieldControlClassName('ui-field__control', error !== undefined, className),
          !prefersReducedMotion && 'ui-field__control--motion',
        )}
      />
      {error !== undefined ? <FieldError id={errorId ?? `${fieldId}-error`} message={error} /> : null}
    </div>
  )
}
