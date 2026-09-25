/**
 * `Chip` (DTJ-404, `SRS-UX-002`, `32-design-reference.md` расхождение №4) — переключаемый фильтр.
 * Визуальная высота контента (`CHIP_CONTENT_HEIGHT_PX` = 32px) МЕНЬШЕ минимума `SRS-UX-002`
 * (компактность, допустимая дизайном), но эффективная область попадания — 48×48px, добираемая
 * `padding` (hit-slop), а НЕ раздуванием видимого чипа: вертикальный padding закрывает разницу
 * 32→48 по высоте, горизонтальный (`CHIP_PADDING_X_PX` = 24px с каждой стороны) гарантирует ≥48px
 * по ширине уже от одного `padding`, независимо от длины текста — реальный рендер (текст поверх
 * padding) не может оказаться ниже этого минимума, только выше. Тест — `chip.spec.tsx` (AC4).
 */
import { type CSSProperties, type ReactElement, type ReactNode, useState } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'

export interface ChipProps {
  readonly selected: boolean
  readonly onToggle?: () => void
  readonly children: ReactNode
}

const CHIP_CONTENT_HEIGHT_PX = 32
const CHIP_PADDING_X_PX = MIN_HIT_AREA_PX / 2 // 24px — см. JSDoc модуля
const CHIP_PADDING_Y_PX = (MIN_HIT_AREA_PX - CHIP_CONTENT_HEIGHT_PX) / 2 // 8px
const CHIP_FONT_SIZE_PX = 14

const SELECTED_PALETTE: CSSProperties = {
  background: 'var(--brand-primary)',
  color: 'var(--brand-surface)',
  border: '1px solid transparent',
}
const UNSELECTED_PALETTE: CSSProperties = {
  background: 'var(--brand-surface)',
  color: 'var(--brand-text)',
  border: '1px solid var(--brand-border)',
}

const resolvePalette = (selected: boolean): CSSProperties =>
  selected ? SELECTED_PALETTE : UNSELECTED_PALETTE

export const Chip = ({ selected, onToggle, children }: ChipProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [isFocused, setIsFocused] = useState(false)
  const palette = resolvePalette(selected)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      onFocus={() => { setIsFocused(true) }}
      onBlur={() => { setIsFocused(false) }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'content-box',
        height: `${String(CHIP_CONTENT_HEIGHT_PX)}px`,
        padding: `${String(CHIP_PADDING_Y_PX)}px ${String(CHIP_PADDING_X_PX)}px`,
        borderRadius: 'var(--radius-full)',
        fontSize: `${String(CHIP_FONT_SIZE_PX)}px`,
        fontFamily: 'var(--brand-font-family)',
        fontWeight: 'var(--font-weight-medium)',
        cursor: 'pointer',
        // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
        outline: isFocused ? 'none' : undefined,
        boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
        transition: buildTransition(['background', 'box-shadow'], prefersReducedMotion),
        ...palette,
      }}
    >
      {children}
    </button>
  )
}
