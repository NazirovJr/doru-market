/**
 * `IconButton` (DTJ-404, `SRS-UX-002`/`SRS-UX-021`) — круглая кнопка-иконка, минимум 48×48px
 * ЭФФЕКТИВНОЙ области попадания независимо от визуального размера иконки внутри (hit-slop через
 * `padding`, не раздувание видимого круга — `32-design-reference.md` расхождение №4).
 *
 * `aria-label` — ОБЯЗАТЕЛЬНЫЙ проп на уровне типов (`RequiredAriaLabel`), а не рантайм-проверка:
 * `<IconButton>` без `aria-label` не компилируется (критерий приёмки 2). Технически это достигается
 * пересечением с типом, который делает `aria-label: string` обязательным полем, переопределяя
 * опциональный `aria-label?: string` из `AriaAttributes`.
 */
import { type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode, useState } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { ACTIVE_SCALE, DISABLED_OPACITY, buildTransition } from '../internal/motion'

/** Делает `aria-label` обязательным (не наследует опциональность из `AriaAttributes`). */
interface RequiredAriaLabel {
  readonly 'aria-label': string
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>,
    RequiredAriaLabel {
  readonly icon: ReactNode
}

const ICON_BUTTON_SIZE_PX = MIN_HIT_AREA_PX

interface IconButtonInteractionState {
  readonly isHovered: boolean
  readonly isActive: boolean
  readonly isFocused: boolean
}

interface IconButtonStyleInput extends IconButtonInteractionState {
  readonly disabled: boolean
  readonly prefersReducedMotion: boolean
}

const buildIconButtonStyle = ({
  isHovered,
  isActive,
  isFocused,
  disabled,
  prefersReducedMotion,
}: IconButtonStyleInput): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  width: `${String(ICON_BUTTON_SIZE_PX)}px`,
  height: `${String(ICON_BUTTON_SIZE_PX)}px`,
  borderRadius: 'var(--radius-full)',
  border: '1px solid transparent',
  background: isActive || isHovered ? 'var(--brand-bg)' : 'transparent',
  color: 'var(--brand-text)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? DISABLED_OPACITY : 1,
  // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
  outline: isFocused ? 'none' : undefined,
  boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
  transform: isActive && !disabled ? `scale(${String(ACTIVE_SCALE)})` : 'scale(1)',
  transition: buildTransition(['background', 'transform', 'box-shadow'], prefersReducedMotion),
})

export const IconButton = ({
  icon,
  disabled = false,
  style,
  ...rest
}: IconButtonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [interaction, setInteraction] = useState<IconButtonInteractionState>({
    isHovered: false,
    isActive: false,
    isFocused: false,
  })

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={disabled}
      onMouseEnter={() => { setInteraction((previous) => ({ ...previous, isHovered: true })) }}
      onMouseLeave={() => { setInteraction((previous) => ({ ...previous, isHovered: false, isActive: false })) }}
      onMouseDown={() => { setInteraction((previous) => ({ ...previous, isActive: true })) }}
      onMouseUp={() => { setInteraction((previous) => ({ ...previous, isActive: false })) }}
      onFocus={() => { setInteraction((previous) => ({ ...previous, isFocused: true })) }}
      onBlur={() => { setInteraction((previous) => ({ ...previous, isFocused: false })) }}
      style={{
        ...buildIconButtonStyle({ ...interaction, disabled, prefersReducedMotion }),
        ...style,
      }}
    >
      {icon}
    </button>
  )
}
