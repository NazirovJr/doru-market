/**
 * `Input` (DTJ-404, `SRS-UX-019`/`SRS-UX-034` «Форма») — текстовый ввод со встроенным
 * `error`-слотом (см. `FieldChrome`). Контролируемый компонент: значение приходит через проп
 * `value`, набор текста НЕ мутирует его напрямую — родитель обязан прокинуть `onChange`
 * (стандартный React-контракт, тест `input.spec.tsx` проверяет отсутствие мутации).
 */
import { type InputHTMLAttributes, type ReactElement, useId, useState } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { FieldChrome } from '../internal/field-chrome'

const INPUT_HEIGHT_PX = MIN_HIT_AREA_PX

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly id?: string
  readonly label: string
  readonly error?: string
}

export const Input = ({
  id,
  label,
  error,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps): ReactElement => {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [isFocused, setIsFocused] = useState(false)
  return (
    <FieldChrome id={inputId} label={label} error={error}>
      {(describedBy) => (
        <input
          {...rest}
          id={inputId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          onFocus={(event) => {
            setIsFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setIsFocused(false)
            onBlur?.(event)
          }}
          style={{
            boxSizing: 'border-box',
            height: `${String(INPUT_HEIGHT_PX)}px`,
            padding: '0 var(--space-3)',
            fontSize: 'var(--font-size-base)',
            fontFamily: 'var(--brand-font-family)',
            color: 'var(--brand-text)',
            background: 'var(--brand-surface)',
            border: `1px solid ${error === undefined ? 'var(--brand-border)' : 'var(--brand-danger)'}`,
            borderRadius: 'var(--radius-sm)',
            // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
            outline: isFocused ? 'none' : undefined,
            boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
            ...style,
          }}
        />
      )}
    </FieldChrome>
  )
}
