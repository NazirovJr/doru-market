import { useId } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './switch.css'

export interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** Видимый текст рядом с тумблером — единственный источник доступного имени кнопки
   * `role="switch"` (`aria-labelledby`, не дублируется отдельным `aria-label`). */
  readonly label: string
  readonly disabled?: boolean
  readonly id?: string
}

const TRACK_WIDTH_PX = 44
const TRACK_HEIGHT_PX = 24
const MIN_HIT_AREA_PX = 48
/** В отличие от `Chip`/`Checkbox`/`RadioGroup` (там ширину добирает соседний текст), у трека
 * `Switch` нет содержимого рядом — недостачу нужно добирать padding'ом ПО ОБОИМ измерениям, тот
 * же приём, что `IconButton` (`icon-button.tsx` `getHitSlopStyle`). Инлайн-стиль, не CSS-токен —
 * `jsdom` в `assertHitArea`-тестах не резолвит `var(--space-*)` через `getComputedStyle`. */
const HORIZONTAL_HIT_SLOP_PX = Math.max(0, (MIN_HIT_AREA_PX - TRACK_WIDTH_PX) / 2)
const VERTICAL_HIT_SLOP_PX = Math.max(0, (MIN_HIT_AREA_PX - TRACK_HEIGHT_PX) / 2)

const HIT_SLOP_STYLE: CSSProperties = {
  paddingLeft: `${String(HORIZONTAL_HIT_SLOP_PX)}px`,
  paddingRight: `${String(HORIZONTAL_HIT_SLOP_PX)}px`,
  paddingTop: `${String(VERTICAL_HIT_SLOP_PX)}px`,
  paddingBottom: `${String(VERTICAL_HIT_SLOP_PX)}px`,
}

/**
 * Тумблер `on`/`off` (`SRS-UX-021`) — `role="switch"` + `aria-checked`, анимация переключения
 * уважает `useReducedMotion()` (`DTJ-405` п.6). Видимый трек 24px высотой, эффективная область
 * попадания кнопки ≥48×48px через hit-slop.
 */
export const Switch = ({ checked, onChange, label, disabled = false, id }: SwitchProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const switchId = id ?? generatedId
  const labelId = `${switchId}-label`

  return (
    <span className="ui-switch-row">
      <span className="ui-switch-row__label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => {
          onChange(!checked)
        }}
        className={cx('ui-switch', checked && 'ui-switch--checked', !prefersReducedMotion && 'ui-switch--motion')}
        style={HIT_SLOP_STYLE}
      >
        <span className="ui-switch__track">
          <span className="ui-switch__thumb" />
        </span>
      </button>
    </span>
  )
}
