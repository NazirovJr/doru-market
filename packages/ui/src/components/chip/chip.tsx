import type { ButtonHTMLAttributes, CSSProperties, ReactElement, ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './chip.css'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Переключён/не переключён (`aria-pressed`) — переключаемый фильтр, не обычная кнопка. */
  readonly selected: boolean
  readonly children: ReactNode
}

const VISUAL_HEIGHT_PX = 32
const MIN_HIT_AREA_PX = 48
/** Половина недостачи высоты — `padding-block` (hit-slop), реальный клик-таргет всегда ≥48px,
 * визуальная высота остаётся компактной 32px (`32-design-reference.md`, расхождение №4). */
const VERTICAL_HIT_SLOP_PX = (MIN_HIT_AREA_PX - VISUAL_HEIGHT_PX) / 2

const HIT_SLOP_STYLE: CSSProperties = {
  height: `${String(VISUAL_HEIGHT_PX)}px`,
  paddingTop: `${String(VERTICAL_HIT_SLOP_PX)}px`,
  paddingBottom: `${String(VERTICAL_HIT_SLOP_PX)}px`,
}

/**
 * Переключаемый фильтр-чип (`SRS-UX-021`, AC4). Визуально компактный (32px высотой), эффективная
 * область попадания ≥48×48px через `padding-block` (hit-slop, не раздувает видимую высоту).
 */
export const Chip = ({ selected, className, style, children, ...rest }: ChipProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-pressed={selected}
      className={cx(
        'ui-chip',
        selected && 'ui-chip--selected',
        !prefersReducedMotion && 'ui-chip--motion',
        className,
      )}
      style={{ ...HIT_SLOP_STYLE, ...style }}
    >
      {children}
    </button>
  )
}
