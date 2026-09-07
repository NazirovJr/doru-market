import type { ButtonHTMLAttributes, CSSProperties, ReactElement, ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './icon-button.css'

export type IconButtonSize = 'md' | 'sm'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  readonly icon: ReactNode
  /** ОБЯЗАТЕЛЕН (не `?:`) — компонент не собирается TypeScript'ом без доступного имени
   * (`SRS-UX-034` «доступное имя, если только иконка»), см. `icon-button.spec.tsx` AC2. */
  readonly 'aria-label': string
  /** `md` — визуальный круг 48px (тап-зона = визуал). `sm` — визуальный круг 32px (компактные
   * места вроде шапки экрана, `32-design-reference.md` расхождение №4), тап-зона всё равно
   * добирается до 48px через `padding` (hit-slop), не раздувает видимый круг. */
  readonly size?: IconButtonSize
}

const MIN_HIT_AREA_PX = 48
/** Диаметр видимого круга по размеру — единственное место, где эти числа объявлены (`SRS-UX-002`,
 * `HIT_SLOP_STRATEGY`: `sm` добирает недостающее до `MIN_HIT_AREA_PX` через `padding`). */
const VISUAL_DIAMETER_PX: Readonly<Record<IconButtonSize, number>> = { md: 48, sm: 32 }

function getHitSlopStyle(size: IconButtonSize): CSSProperties {
  const visualDiameterPx = VISUAL_DIAMETER_PX[size]
  const hitSlopPx = Math.max(0, (MIN_HIT_AREA_PX - visualDiameterPx) / 2)
  return {
    width: `${String(visualDiameterPx)}px`,
    height: `${String(visualDiameterPx)}px`,
    padding: `${String(hitSlopPx)}px`,
  }
}

/**
 * Круглая кнопка-иконка (`SRS-UX-021`). Минимум 48×48px эффективной области ВСЕГДА, независимо от
 * визуального размера круга (`size="sm"` = 32px видимо, hit-slop добирает недостающее padding'ом,
 * не растягивая видимый круг) — расхождение №4 `docs/spec/32-design-reference.md`.
 */
export const IconButton = ({
  icon,
  size = 'md',
  className,
  style,
  ...rest
}: IconButtonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const hitSlopStyle = getHitSlopStyle(size)

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={cx('ui-icon-button', !prefersReducedMotion && 'ui-icon-button--motion', className)}
      style={{ ...hitSlopStyle, ...style }}
    >
      {icon}
    </button>
  )
}
