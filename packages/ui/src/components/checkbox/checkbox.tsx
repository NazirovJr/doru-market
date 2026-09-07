import { useId } from 'react'
import type { CSSProperties, InputHTMLAttributes, ReactElement } from 'react'
import { cx } from '../shared/cx.js'
import './checkbox.css'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  readonly label: string
  readonly id?: string
}

const VISUAL_BOX_PX = 20
const MIN_HIT_AREA_PX = 48
/** Половина недостачи высоты — `padding-block` инлайн-стилем (тот же приём, что `Chip`/
 * `RadioGroup`): `jsdom` в `assertHitArea`-тестах читает только буквальный `px` через
 * `getComputedStyle`, не резолвит `var(--space-*)` (см. `chip.tsx`/`radio-group.tsx`). */
const VERTICAL_HIT_SLOP_PX = (MIN_HIT_AREA_PX - VISUAL_BOX_PX) / 2

const HIT_SLOP_STYLE: CSSProperties = {
  paddingTop: `${String(VERTICAL_HIT_SLOP_PX)}px`,
  paddingBottom: `${String(VERTICAL_HIT_SLOP_PX)}px`,
}

/**
 * Визуальный чекбокс (`SRS-UX-021`) поверх НАТИВНОГО `<input type="checkbox">` (не полностью
 * кастомный `<div>` — сохраняет встроенную клавиатурную/screen-reader поддержку, `DTJ-405` п.5).
 * Видимый квадрат 20×20px, эффективная область попадания ≥48×48px через hit-slop на `<label>`
 * (`AC5`).
 */
export const Checkbox = ({ label, id, className, ...rest }: CheckboxProps): ReactElement => {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <label htmlFor={fieldId} className={cx('ui-checkbox', className)} style={HIT_SLOP_STYLE}>
      <input {...rest} type="checkbox" id={fieldId} className="ui-checkbox__input" />
      <span className="ui-checkbox__box" aria-hidden="true">
        <CheckIcon />
      </span>
      <span className="ui-checkbox__label">{label}</span>
    </label>
  )
}

const CheckIcon = (): ReactElement => (
  <svg className="ui-checkbox__icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
