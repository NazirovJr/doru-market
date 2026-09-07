import { useId } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { cx } from '../shared/cx.js'
import '../input/input.css'
import './radio-group.css'

export interface RadioOption {
  readonly value: string
  readonly label: string
}

const VISUAL_CONTROL_PX = 20
const MIN_HIT_AREA_PX = 48
/** Половина недостачи высоты — `padding-block` (hit-slop), теми же числами, что `Chip`
 * (`chip.tsx` `VERTICAL_HIT_SLOP_PX`) — задаётся ИНЛАЙН-стилем, не CSS-токеном: `jsdom` в
 * `assertHitArea`-тестах не резолвит `var(--space-*)` через `getComputedStyle` (в отличие от
 * реального браузера), только буквальные инлайн-`px` (см. `chip.tsx`/`icon-button.tsx`, тот же
 * приём). */
const VERTICAL_HIT_SLOP_PX = (MIN_HIT_AREA_PX - VISUAL_CONTROL_PX) / 2

const HIT_SLOP_STYLE: CSSProperties = {
  paddingTop: `${String(VERTICAL_HIT_SLOP_PX)}px`,
  paddingBottom: `${String(VERTICAL_HIT_SLOP_PX)}px`,
}

export interface RadioGroupProps {
  readonly name: string
  readonly label: string
  readonly options: readonly RadioOption[]
  readonly value: string | null
  readonly onChange: (value: string) => void
  readonly id?: string
}

/**
 * `RadioGroup` (`SRS-UX-021`) — `role="radiogroup"`, стрелки перемещают выбор внутри группы через
 * НАТИВНОЕ поведение `<input type="radio">` (общий `name`), не реализуется вручную поверх `<div>`
 * (`DTJ-405` п.4). Эффективная область попадания каждой опции ≥48×48px через hit-slop на `<label>`
 * (тот же приём, что `Chip`/`Checkbox`), визуальный кружок остаётся компактным.
 */
export const RadioGroup = ({ name, label, options, value, onChange, id }: RadioGroupProps): ReactElement => {
  const generatedId = useId()
  const groupId = id ?? generatedId

  return (
    <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="ui-radio-group">
      <span className="ui-field__label" id={`${groupId}-label`}>
        {label}
      </span>
      {options.map((option) => {
        const optionId = `${groupId}-${option.value}`
        return (
          <label key={option.value} htmlFor={optionId} className="ui-radio" style={HIT_SLOP_STYLE}>
            <input
              type="radio"
              id={optionId}
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value)
              }}
              className="ui-radio__input"
            />
            <span className="ui-radio__control" aria-hidden="true" />
            <span className={cx('ui-radio__label', value === option.value && 'ui-radio__label--selected')}>
              {option.label}
            </span>
          </label>
        )
      })}
    </div>
  )
}
