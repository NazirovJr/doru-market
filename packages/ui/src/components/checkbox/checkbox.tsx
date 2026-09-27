/**
 * `Checkbox` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-034`) — визуальный чекбокс поверх
 * нативного `<input type="checkbox">` (не полностью кастомный `<div>` без семантики — сохраняет
 * встроенную клавиатурную/screen-reader поддержку). Визуальный квадрат 20×20px, эффективная
 * область попадания — вся строка `<label>`, растянутая нативным `<input>` (`position: absolute;
 * inset: 0`) минимум до `MIN_HIT_AREA_PX` (`SRS-UX-002`, `assertHitArea`).
 *
 * Ширина строки в реальном браузере определяется текстом `label` (почти всегда ≥48px), но короткий
 * текст («Да») не гарантирует минимум сам по себе — как и `Chip` (DTJ-404), недостающая ширина/
 * высота добирается `padding` (`boxSizing: 'content-box'`, тот же приём, что `chip.tsx`: под
 * `jsdom` без реального layout `getComputedStyle().width` для контента равен 0, добор идёт
 * ИСКЛЮЧИТЕЛЬНО через padding — см. `assert-hit-area.ts` JSDoc).
 *
 * Контролируемый компонент: `checked`/`onChange` — источник истины у потребителя.
 */
import { type ReactElement, useId } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { DISABLED_OPACITY } from '../internal/motion'

const CHECKBOX_VISUAL_SIZE_PX = 20
const ROW_CONTENT_HEIGHT_PX = 24
const ROW_PADDING_Y_PX = (MIN_HIT_AREA_PX - ROW_CONTENT_HEIGHT_PX) / 2
const ROW_PADDING_X_PX = MIN_HIT_AREA_PX / 2

export interface CheckboxProps {
  readonly id?: string
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
}

const CheckIcon = (): ReactElement => (
  <svg aria-hidden="true" width={14} height={14} viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.2 5.5 10.2 11.5 3.8" stroke="var(--brand-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Checkbox = ({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: CheckboxProps): ReactElement => {
  const generatedId = useId()
  const checkboxId = id ?? generatedId
  return (
  <label
    htmlFor={checkboxId}
    style={{
      position: 'relative',
      boxSizing: 'content-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      height: `${String(ROW_CONTENT_HEIGHT_PX)}px`,
      padding: `${String(ROW_PADDING_Y_PX)}px ${String(ROW_PADDING_X_PX)}px`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? DISABLED_OPACITY : 1,
    }}
  >
    <input
      id={checkboxId}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => { onChange(event.target.checked) }}
      style={{
        position: 'absolute',
        inset: 0,
        margin: 0,
        opacity: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    />
    <span
      aria-hidden="true"
      style={{
        boxSizing: 'border-box',
        flexShrink: 0,
        width: `${String(CHECKBOX_VISUAL_SIZE_PX)}px`,
        height: `${String(CHECKBOX_VISUAL_SIZE_PX)}px`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${checked ? 'var(--brand-primary)' : 'var(--brand-border)'}`,
        background: checked ? 'var(--brand-primary)' : 'var(--brand-surface)',
      }}
    >
      {checked ? <CheckIcon /> : null}
    </span>
    <span
      style={{
        fontSize: 'var(--font-size-base)',
        fontFamily: 'var(--brand-font-family)',
        color: 'var(--brand-text)',
      }}
    >
      {label}
    </span>
  </label>
  )
}
