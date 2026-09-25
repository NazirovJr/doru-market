/**
 * `RadioGroup` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-034`) — группа радио-кнопок с общим
 * `name`, `role="radiogroup"`. Стрелки внутри группы переключают выбор — переиспользуется
 * НАТИВНОЕ поведение `<input type="radio">` (браузер сам двигает выбор `ArrowUp`/`ArrowDown`
 * между элементами с одинаковым `name` в tab-порядке), НЕ реализуется вручную поверх `<div>`
 * (явное требование тикета).
 *
 * Визуальный радио-круг — поверх нативного `<input>` (сохраняет встроенную
 * клавиатурную/screen-reader семантику), сам `<input>` растянут на весь `<label>` и скрыт
 * визуально (`opacity: 0`, НЕ `display: none`/`visibility: hidden` — иначе выпадает из
 * tab-порядка) — эффективная область попадания клика/тапа = вся строка `<label>` (`SRS-UX-002`,
 * `assertHitArea` ≥48×48px по высоте строки, ширина — на всю доступную). Недостающая ширина/
 * высота (короткий текст, `jsdom` без реального layout) добирается `padding` — тот же приём,
 * что `Chip` (DTJ-404): `boxSizing: 'content-box'`, см. `assert-hit-area.ts` JSDoc.
 */
import { type ReactElement } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { DISABLED_OPACITY } from '../internal/motion'

export interface RadioOption {
  readonly value: string
  readonly label: string
}

export interface RadioGroupProps {
  readonly name: string
  readonly label?: string
  readonly options: readonly RadioOption[]
  readonly value: string | null
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

const RADIO_VISUAL_SIZE_PX = 20
const ROW_CONTENT_HEIGHT_PX = 24
const ROW_PADDING_Y_PX = (MIN_HIT_AREA_PX - ROW_CONTENT_HEIGHT_PX) / 2
const ROW_PADDING_X_PX = MIN_HIT_AREA_PX / 2

const RadioVisual = ({ checked }: { readonly checked: boolean }): ReactElement => (
  <span
    aria-hidden="true"
    style={{
      boxSizing: 'border-box',
      flexShrink: 0,
      width: `${String(RADIO_VISUAL_SIZE_PX)}px`,
      height: `${String(RADIO_VISUAL_SIZE_PX)}px`,
      borderRadius: 'var(--radius-full)',
      border: `1px solid ${checked ? 'var(--brand-primary)' : 'var(--brand-border)'}`,
      background: 'var(--brand-surface)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {checked ? (
      <span
        style={{
          width: '10px',
          height: '10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--brand-primary)',
        }}
      />
    ) : null}
  </span>
)

export const RadioGroup = ({
  name,
  label,
  options,
  value,
  onChange,
  disabled = false,
}: RadioGroupProps): ReactElement => (
  <div
    role="radiogroup"
    aria-label={label}
    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
  >
    {options.map((option) => {
      const checked = option.value === value
      const isOptionDisabled = disabled
      return (
        <label
          key={option.value}
          style={{
            position: 'relative',
            boxSizing: 'content-box',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            height: `${String(ROW_CONTENT_HEIGHT_PX)}px`,
            padding: `${String(ROW_PADDING_Y_PX)}px ${String(ROW_PADDING_X_PX)}px`,
            cursor: isOptionDisabled ? 'not-allowed' : 'pointer',
            opacity: isOptionDisabled ? DISABLED_OPACITY : 1,
          }}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={checked}
            disabled={isOptionDisabled}
            onChange={() => { onChange(option.value) }}
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              opacity: 0,
              cursor: isOptionDisabled ? 'not-allowed' : 'pointer',
            }}
          />
          <RadioVisual checked={checked} />
          <span
            style={{
              fontSize: 'var(--font-size-base)',
              fontFamily: 'var(--brand-font-family)',
              color: 'var(--brand-text)',
            }}
          >
            {option.label}
          </span>
        </label>
      )
    })}
  </div>
)
