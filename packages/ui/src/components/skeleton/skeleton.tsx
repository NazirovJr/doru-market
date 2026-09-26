/**
 * `Skeleton` (DTJ-404, `SRS-UX-019`) — плейсхолдер загрузки под строку/карточку/чип. Shimmer —
 * CSS-анимация (`@keyframes dorutj-shimmer`, `skeleton.css`), НЕ JS-таймер. Уважает
 * `useReducedMotion()`: при включённом предпочтении `style.animation` не выставляется вовсе —
 * статичный полупрозрачный фон вместо shimmer (критерий приёмки 5).
 */
import { type CSSProperties, type ReactElement } from 'react'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import './skeleton.css'

export type SkeletonVariant = 'text' | 'card' | 'row'

export interface SkeletonProps {
  readonly variant?: SkeletonVariant
  readonly width?: string | number
  readonly className?: string
}

const SHIMMER_DURATION_MS = 1400
const VARIANT_HEIGHT_PX: Readonly<Record<SkeletonVariant, number>> = {
  text: 16,
  row: 56,
  card: 160,
}
const VARIANT_RADIUS: Readonly<Record<SkeletonVariant, string>> = {
  text: 'var(--radius-sm)',
  row: 'var(--radius-sm)',
  card: 'var(--radius-md)',
}

export const Skeleton = ({ variant = 'text', width = '100%', className }: SkeletonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const style: CSSProperties = {
    display: 'block',
    boxSizing: 'border-box',
    width,
    height: `${String(VARIANT_HEIGHT_PX[variant])}px`,
    borderRadius: VARIANT_RADIUS[variant],
    background: 'var(--brand-border)',
    // Reduced motion (AC5): `animation` не выставляется вовсе — `getComputedStyle(...).animation`
    // возвращает начальное значение (нет активной анимации), а не shimmer.
    animation: prefersReducedMotion
      ? undefined
      : `dorutj-shimmer ${String(SHIMMER_DURATION_MS)}ms ease-in-out infinite`,
  }
  return <div role="presentation" aria-hidden="true" className={className} style={style} />
}
