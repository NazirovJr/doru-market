import type { ReactElement } from 'react'

export interface FieldErrorProps {
  readonly id: string
  readonly message: string
}

/**
 * `error`-слот `Input`/`Textarea` (`SRS-UX-019` `error`, `SRS-UX-034` «Форма»): иконка + текст ПОД
 * полем — не только цвет рамки. `id` связывается с `aria-describedby` поля потребителем
 * (`input.tsx`/`textarea.tsx`), сам по себе этот компонент не знает, к какому полю относится.
 */
export const FieldError = ({ id, message }: FieldErrorProps): ReactElement => (
  <p id={id} className="ui-field__error">
    <WarningIcon />
    <span>{message}</span>
  </p>
)

const WarningIcon = (): ReactElement => (
  <svg
    className="ui-field__error-icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M8 1.5 15 14H1L8 1.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M8 6.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="12" r="0.9" fill="currentColor" />
  </svg>
)
