/**
 * `FieldChrome` (DTJ-404, `SRS-UX-019`/`SRS-UX-034` «Форма») — общая обвязка `label` + `error`-слот,
 * переиспользуемая `Input` и `Textarea`: связывает `<label htmlFor>` с полем и рендерит текст
 * ошибки ПОД полем с иконкой предупреждения (не только рамка) — `aria-describedby` на самом поле
 * указывает на `id` этого текста, `role="alert"` объявляет его screen reader'у сразу при появлении.
 */
import { type ReactElement, type ReactNode } from 'react'

const ERROR_ICON_SIZE_PX = 16

export interface FieldChromeProps {
  readonly id: string
  readonly label: string
  readonly error?: string | undefined
  readonly children: (describedBy: string | undefined) => ReactNode
}

const WarningIcon = (): ReactElement => (
  <svg
    aria-hidden="true"
    width={ERROR_ICON_SIZE_PX}
    height={ERROR_ICON_SIZE_PX}
    viewBox="0 0 16 16"
    fill="none"
  >
    <path
      d="M8 1.5 1 14h14L8 1.5Z"
      stroke="var(--brand-danger)"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M8 6v4" stroke="var(--brand-danger)" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="11.5" r="0.75" fill="var(--brand-danger)" />
  </svg>
)

export const FieldChrome = ({ id, label, error, children }: FieldChromeProps): ReactElement => {
  const errorId = error === undefined ? undefined : `${id}-error`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--brand-text)',
          fontFamily: 'var(--brand-font-family)',
        }}
      >
        {label}
      </label>
      {children(errorId)}
      {error !== undefined ? (
        <p
          id={errorId}
          role="alert"
          style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            color: 'var(--brand-danger-text)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'var(--brand-font-family)',
          }}
        >
          <WarningIcon />
          {error}
        </p>
      ) : null}
    </div>
  )
}
