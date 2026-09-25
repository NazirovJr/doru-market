/**
 * `Button` (DTJ-404, `SRS-UX-019`/`SRS-UX-021`) — основной CTA-компонент, первый примитив
 * `packages/ui`. 4 варианта (`primary/secondary/danger/ghost`), 2 размера (`md`=48px/`lg`=56px,
 * `SRS-UX-002`), 7 состояний §2.5 `docs/spec/30-ux-screens-and-flows.md`.
 *
 * `loading` сохраняет ширину кнопки (текст скрыт через `visibility: hidden`, не удалён из DOM —
 * `aria-busy="true"` + реальный HTML `disabled` на время загрузки, критерий приёмки 1). Персистентный
 * `disabled` (проп, не `loading`) НЕ использует нативный `disabled` — кнопка остаётся в tab-order
 * (`aria-disabled="true"` + программный guard `onClick`), т.к. дизайн требует «действие видно, но
 * недоступно», а не исчезновение из клавиатурной навигации (`SRS-UX-019` disabled-строка).
 *
 * Горизонтальный padding намеренно ≥ половины `MIN_HIT_AREA_PX`/`CRITICAL_HIT_AREA_PX` с каждой
 * стороны: под `jsdom` эффективная тап-зона считается из `padding` (`measureFromStyle` в
 * `a11y/assert-hit-area.ts` не видит текстовую раскладку — `getBoundingClientRect` всегда 0), а в
 * реальном браузере текст добавляет ширину поверх этого минимума — см. `button.spec.tsx`.
 */
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from 'react'
import { CRITICAL_HIT_AREA_PX, MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { ACTIVE_SCALE, DISABLED_OPACITY, buildTransition } from '../internal/motion'
import { Spinner } from '../internal/spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Состояние загрузки (§2.5 `SRS-UX-019` `loading`) — текст скрыт, ширина не меняется. */
  readonly loading?: boolean
  readonly children: ReactNode
}

const BUTTON_HEIGHT_PX: Readonly<Record<ButtonSize, number>> = {
  md: MIN_HIT_AREA_PX,
  lg: CRITICAL_HIT_AREA_PX,
}

const BUTTON_PADDING_X_PX: Readonly<Record<ButtonSize, number>> = {
  md: MIN_HIT_AREA_PX / 2,
  lg: CRITICAL_HIT_AREA_PX / 2,
}

const BUTTON_FONT_SIZE_PX = 16
const BUTTON_GAP_PX = 8

interface VariantPalette {
  readonly background: string
  readonly backgroundHover: string
  readonly backgroundActive: string
  readonly color: string
  readonly border: string
}

const VARIANT_PALETTES: Readonly<Record<ButtonVariant, VariantPalette>> = {
  primary: {
    background: 'var(--brand-primary)',
    backgroundHover: 'var(--brand-primary-hover)',
    backgroundActive: 'var(--brand-primary-hover)',
    color: 'var(--brand-surface)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--brand-surface)',
    backgroundHover: 'var(--brand-bg)',
    backgroundActive: 'var(--brand-bg)',
    color: 'var(--brand-text)',
    border: '1px solid var(--brand-border)',
  },
  danger: {
    background: 'var(--brand-danger)',
    backgroundHover: 'var(--brand-danger-text)',
    backgroundActive: 'var(--brand-danger-text)',
    color: 'var(--brand-surface)',
    border: '1px solid transparent',
  },
  ghost: {
    background: 'transparent',
    backgroundHover: 'var(--brand-bg)',
    backgroundActive: 'var(--brand-bg)',
    color: 'var(--brand-primary)',
    border: '1px solid transparent',
  },
}

const resolveBackground = (
  palette: VariantPalette,
  isActive: boolean,
  isHovered: boolean,
): string => {
  if (isActive) {
    return palette.backgroundActive
  }
  return isHovered ? palette.backgroundHover : palette.background
}

interface InteractionState {
  readonly isHovered: boolean
  readonly isActive: boolean
  readonly isFocused: boolean
}

const useInteractionHandlers = (): {
  readonly state: InteractionState
  readonly handlers: Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onMouseEnter' | 'onMouseLeave' | 'onMouseDown' | 'onMouseUp' | 'onFocus' | 'onBlur'
  >
} => {
  const [state, setState] = useState<InteractionState>({
    isHovered: false,
    isActive: false,
    isFocused: false,
  })
  return {
    state,
    handlers: {
      onMouseEnter: () => { setState((previous) => ({ ...previous, isHovered: true })) },
      onMouseLeave: () => { setState({ isHovered: false, isActive: false, isFocused: state.isFocused }) },
      onMouseDown: () => { setState((previous) => ({ ...previous, isActive: true })) },
      onMouseUp: () => { setState((previous) => ({ ...previous, isActive: false })) },
      onFocus: () => { setState((previous) => ({ ...previous, isFocused: true })) },
      onBlur: () => { setState((previous) => ({ ...previous, isFocused: false })) },
    },
  }
}

interface ButtonStyleInput {
  readonly variant: ButtonVariant
  readonly size: ButtonSize
  readonly interaction: InteractionState
  readonly isPersistentlyDisabled: boolean
  readonly isLoading: boolean
  readonly prefersReducedMotion: boolean
}

const buildButtonStyle = ({
  variant,
  size,
  interaction,
  isPersistentlyDisabled,
  isLoading,
  prefersReducedMotion,
}: ButtonStyleInput): CSSProperties => {
  const palette = VARIANT_PALETTES[variant]
  const isDimmed = isPersistentlyDisabled || isLoading
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${String(BUTTON_GAP_PX)}px`,
    boxSizing: 'border-box',
    height: `${String(BUTTON_HEIGHT_PX[size])}px`,
    padding: `0 ${String(BUTTON_PADDING_X_PX[size])}px`,
    fontSize: `${String(BUTTON_FONT_SIZE_PX)}px`,
    fontFamily: 'var(--brand-font-family)',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--radius-sm)',
    border: palette.border,
    background: resolveBackground(palette, interaction.isActive, interaction.isHovered),
    color: palette.color,
    cursor: isDimmed ? 'not-allowed' : 'pointer',
    opacity: isPersistentlyDisabled ? DISABLED_OPACITY : 1,
    transform: interaction.isActive && !isDimmed ? `scale(${String(ACTIVE_SCALE)})` : 'scale(1)',
    // `outline` подавляется ТОЛЬКО одновременно с заменой через `box-shadow` (когда в фокусе) —
    // иначе `focusIndicatorAuditor` (DTJ-403) верно ловит статическое подавление без замены
    // на состоянии покоя (WCAG 2.4.7, `SRS-UX-019`).
    outline: interaction.isFocused ? 'none' : undefined,
    boxShadow: interaction.isFocused ? 'var(--focus-ring)' : 'none',
    transition: buildTransition(
      ['background', 'transform', 'box-shadow', 'opacity'],
      prefersReducedMotion,
    ),
  }
}

const LOADING_OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

interface ButtonContentProps {
  readonly loading: boolean
  readonly prefersReducedMotion: boolean
  readonly children: ReactNode
}

/** Текст остаётся в DOM (`visibility: hidden`, не удалён) — сохраняет ширину кнопки (AC1). */
const ButtonContent = ({ loading, prefersReducedMotion, children }: ButtonContentProps): ReactElement => (
  <>
    <span style={{ visibility: loading ? 'hidden' : 'visible' }}>{children}</span>
    {loading && (
      <span style={LOADING_OVERLAY_STYLE}>
        <Spinner prefersReducedMotion={prefersReducedMotion} />
      </span>
    )}
  </>
)

const resolveIsPersistentlyDisabled = (disabled: boolean, loading: boolean): boolean =>
  disabled && !loading

/**
 * Основной CTA-компонент. `aria-disabled` используется для персистентного `disabled` (остаётся
 * в tab-order), а `disabled`-атрибут HTML — только для `loading` (временная блокировка).
 */
export const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  onClick,
  type = 'button',
  style,
  ...rest
}: ButtonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const { state, handlers } = useInteractionHandlers()
  const isPersistentlyDisabled = resolveIsPersistentlyDisabled(disabled, loading)

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (isPersistentlyDisabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...rest}
      {...handlers}
      type={type}
      onClick={handleClick}
      disabled={loading}
      aria-disabled={isPersistentlyDisabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      style={{
        ...buildButtonStyle({
          variant,
          size,
          interaction: state,
          isPersistentlyDisabled,
          isLoading: loading,
          prefersReducedMotion,
        }),
        ...style,
      }}
    >
      <ButtonContent loading={loading} prefersReducedMotion={prefersReducedMotion}>
        {children}
      </ButtonContent>
    </button>
  )
}
