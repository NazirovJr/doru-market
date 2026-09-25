/**
 * `Switch` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-020`/`SRS-UX-034`) — тумблер `on`/`off`.
 * `role="switch"` + `aria-checked` объявлены явно на нативном `<input type="checkbox">`
 * (браузеры поддерживают переопределение роли на встроенном чекбоксе — сохраняет клавиатурную
 * активацию `Space`/screen-reader семантику checkbox-подобного элемента без ручной реализации
 * поверх `<div>`/`<button>`). Анимация ползунка уважает `useReducedMotion` (`SRS-UX-020`).
 *
 * Ширина/высота строки-`<label>` добираются `padding` до `MIN_HIT_AREA_PX` (`boxSizing:
 * 'content-box'`) — тот же приём, что `Chip`/`Checkbox`/`RadioGroup`, см. `assert-hit-area.ts`.
 */
import { type ReactElement, useId } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { DISABLED_OPACITY, buildTransition } from '../internal/motion'

export interface SwitchProps {
  readonly id?: string
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
}

const TRACK_WIDTH_PX = 40
const TRACK_HEIGHT_PX = 24
const THUMB_SIZE_PX = 18
const THUMB_INSET_PX = 3
const THUMB_TRAVEL_PX = TRACK_WIDTH_PX - THUMB_SIZE_PX - THUMB_INSET_PX * 2
const ROW_CONTENT_HEIGHT_PX = 24
const ROW_PADDING_Y_PX = (MIN_HIT_AREA_PX - ROW_CONTENT_HEIGHT_PX) / 2
const ROW_PADDING_X_PX = MIN_HIT_AREA_PX / 2

export const Switch = ({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: SwitchProps): ReactElement => {
  const generatedId = useId()
  const switchId = id ?? generatedId
  const prefersReducedMotion = useReducedMotion()

  return (
    <label
      htmlFor={switchId}
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
        id={switchId}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
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
          position: 'relative',
          width: `${String(TRACK_WIDTH_PX)}px`,
          height: `${String(TRACK_HEIGHT_PX)}px`,
          borderRadius: 'var(--radius-full)',
          background: checked ? 'var(--brand-primary)' : 'var(--brand-border)',
          transition: buildTransition(['background'], prefersReducedMotion),
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: `${String(THUMB_INSET_PX)}px`,
            left: `${String(THUMB_INSET_PX)}px`,
            width: `${String(THUMB_SIZE_PX)}px`,
            height: `${String(THUMB_SIZE_PX)}px`,
            borderRadius: 'var(--radius-full)',
            background: 'var(--brand-surface)',
            transform: checked ? `translateX(${String(THUMB_TRAVEL_PX)}px)` : 'translateX(0)',
            transition: buildTransition(['transform'], prefersReducedMotion),
          }}
        />
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
