import { useCallback } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** `SRS-UX-021`: `primary` — основной CTA, `secondary` — второстепенный, `danger` — разрушительное
   * действие, `ghost` — третичное. `error` кнопки трактуется как `variant="danger"` в контексте
   * формы (тикет DTJ-404 п.1), отдельного состояния поверх остальных шести не существует. */
  readonly variant?: ButtonVariant
  /** `md` — 48px (стандартный CUJ), `lg` — 56px (критичные действия кабинета аптеки, `SRS-UX-002`). */
  readonly size?: ButtonSize
  /** Спиннер вместо текста на месте текста, ширина не меняется (`visibility: hidden`, текст
   * остаётся в DOM), `aria-busy="true"`, кнопка временно `disabled` (`SRS-UX-019` `loading`). */
  readonly loading?: boolean
  readonly children: ReactNode
}

const DEFAULT_VARIANT: ButtonVariant = 'primary'
const DEFAULT_SIZE: ButtonSize = 'md'

interface ButtonClassNameInput {
  readonly variant: ButtonVariant
  readonly size: ButtonSize
  readonly isMotionEnabled: boolean
  readonly isVisuallyDisabled: boolean
  readonly className: string | undefined
}

function getButtonClassName(input: ButtonClassNameInput): string {
  const { variant, size, isMotionEnabled, isVisuallyDisabled, className } = input
  return cx(
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    isMotionEnabled && 'ui-button--motion',
    isVisuallyDisabled && 'ui-button--disabled',
    className,
  )
}

interface ButtonAriaProps {
  readonly 'aria-busy': true | undefined
  readonly 'aria-disabled': true | undefined
}

function getButtonAriaProps(loading: boolean, isVisuallyDisabled: boolean): ButtonAriaProps {
  return {
    'aria-busy': loading || undefined,
    'aria-disabled': isVisuallyDisabled || undefined,
  }
}

interface ButtonLabelProps {
  readonly loading: boolean
  readonly children: ReactNode
}

const ButtonLabel = ({ loading, children }: ButtonLabelProps): ReactElement => (
  <>
    <span
      className={cx('ui-button__label', loading && 'ui-button__label--loading')}
      style={loading ? { visibility: 'hidden' } : undefined}
    >
      {children}
    </span>
    {loading ? <ButtonSpinner /> : null}
  </>
)

function useButtonClick(
  isVisuallyDisabled: boolean,
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined,
): (event: MouseEvent<HTMLButtonElement>) => void {
  return useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (isVisuallyDisabled) {
        event.preventDefault()
        return
      }
      onClick?.(event)
    },
    [isVisuallyDisabled, onClick],
  )
}

/**
 * Основной CTA дизайн-системы (`SRS-UX-021`). `disabled` НЕ снимает элемент с tab-order (только
 * `aria-disabled` + перехват клика) — в отличие от `loading`, которая использует нативный
 * `disabled`, потому что состояние ожидаемо временное (`SRS-UX-019`). Переходы между состояниями —
 * CSS `transition` (решение CTO вместо `framer-motion`, см. `button.css`), уважают
 * `useReducedMotion()`.
 */
export const Button = ({
  variant = DEFAULT_VARIANT,
  size = DEFAULT_SIZE,
  loading = false,
  disabled = false,
  className,
  onClick,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const isVisuallyDisabled = disabled && !loading
  const handleClick = useButtonClick(isVisuallyDisabled, onClick)

  return (
    <button
      {...rest}
      {...getButtonAriaProps(loading, isVisuallyDisabled)}
      type={type}
      disabled={loading}
      onClick={handleClick}
      className={getButtonClassName({
        variant,
        size,
        isMotionEnabled: !prefersReducedMotion,
        isVisuallyDisabled,
        className,
      })}
    >
      <ButtonLabel loading={loading}>{children}</ButtonLabel>
    </button>
  )
}

const ButtonSpinner = (): ReactElement => (
  <span className="ui-button__spinner" aria-hidden="true">
    <svg className="ui-button__spinner-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </span>
)
