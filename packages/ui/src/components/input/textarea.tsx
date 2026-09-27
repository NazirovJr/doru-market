/**
 * `Textarea` (DTJ-404, `SRS-UX-019`/`SRS-UX-034` «Форма») — многострочный ввод, тот же контракт
 * `error`-слота/`label`-связки, что и `Input` (см. `FieldChrome`).
 */
import { type ReactElement, type TextareaHTMLAttributes, useId, useState } from 'react'
import { FieldChrome } from '../internal/field-chrome'

const TEXTAREA_MIN_HEIGHT_PX = 96
const TEXTAREA_MIN_ROWS = 3

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly id?: string
  readonly label: string
  readonly error?: string
}

export const Textarea = ({
  id,
  label,
  error,
  style,
  rows = TEXTAREA_MIN_ROWS,
  onFocus,
  onBlur,
  ...rest
}: TextareaProps): ReactElement => {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const [isFocused, setIsFocused] = useState(false)
  return (
    <FieldChrome id={textareaId} label={label} error={error}>
      {(describedBy) => (
        <textarea
          {...rest}
          id={textareaId}
          rows={rows}
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
            minHeight: `${String(TEXTAREA_MIN_HEIGHT_PX)}px`,
            padding: 'var(--space-3)',
            fontSize: 'var(--font-size-base)',
            fontFamily: 'var(--brand-font-family)',
            color: 'var(--brand-text)',
            background: 'var(--brand-surface)',
            border: `1px solid ${error === undefined ? 'var(--brand-border)' : 'var(--brand-danger)'}`,
            borderRadius: 'var(--radius-sm)',
            // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
            outline: isFocused ? 'none' : undefined,
            boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
            resize: 'vertical',
            ...style,
          }}
        />
      )}
    </FieldChrome>
  )
}
