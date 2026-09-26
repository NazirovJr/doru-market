/**
 * `Spinner` (DTJ-404) — внутренний индикатор состояния `loading` (`Button`, `SRS-UX-019`).
 * Не экспортируется из публичных барелей — деталь реализации `Button`.
 */
import { type ReactElement } from 'react'
import './spinner.css'

const SPINNER_SIZE_PX = 20
const SPINNER_BORDER_PX = 2
const SPIN_DURATION_MS = 700

export interface SpinnerProps {
  readonly prefersReducedMotion: boolean
}

export const Spinner = ({ prefersReducedMotion }: SpinnerProps): ReactElement => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      boxSizing: 'border-box',
      width: `${String(SPINNER_SIZE_PX)}px`,
      height: `${String(SPINNER_SIZE_PX)}px`,
      borderRadius: 'var(--radius-full)',
      border: `${String(SPINNER_BORDER_PX)}px solid var(--brand-border)`,
      borderTopColor: 'var(--brand-surface)',
      // Статичная анимация отсутствует при reduced motion (SRS-UX-020) — виден только
      // неподвижный полукруг-индикатор, `aria-busy` на кнопке остаётся источником истины для
      // screen reader независимо от визуального вращения.
      animation: prefersReducedMotion
        ? undefined
        : `dorutj-spin ${String(SPIN_DURATION_MS)}ms linear infinite`,
    }}
  />
)
