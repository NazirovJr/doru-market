/**
 * `Badge` (DTJ-404, `SRS-UX-019`/`SRS-UX-034`) — статус-метка. `tone` определяет цвет/семантику
 * (`success/danger/warning/neutral`), маппинг конкретного доменного enum (`order.status` и т.п.)
 * на `tone` — ответственность ПОТРЕБИТЕЛЯ (`entities`-слой фронта), `Badge` остаётся в `shared` и
 * не знает про доменные статусы (`SRS-UX-021`). `children` — ОБЯЗАТЕЛЬНЫЙ текст: статус не
 * передаётся только цветом (`SRS-UX-019`/`SRS-UX-034`) — типы не позволяют `Badge` без текста.
 */
import { type ReactElement, type ReactNode } from 'react'

export type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral'

export interface BadgeProps {
  readonly tone?: BadgeTone
  /** Текст статуса — обязателен, не может быть пустым (только цвет запрещён требованием). */
  readonly children: ReactNode
}

interface TonePalette {
  readonly background: string
  readonly color: string
  readonly border: string
}

const TONE_PALETTES: Readonly<Record<BadgeTone, TonePalette>> = {
  success: {
    background: 'var(--brand-success-bg)',
    color: 'var(--brand-success-text)',
    border: 'var(--brand-success-border)',
  },
  danger: {
    background: 'var(--brand-danger-bg)',
    color: 'var(--brand-danger-text)',
    border: 'var(--brand-danger-border)',
  },
  warning: {
    background: 'var(--brand-warning-bg)',
    color: 'var(--brand-warning-text)',
    border: 'var(--brand-warning-border)',
  },
  neutral: {
    background: 'var(--brand-bg)',
    color: 'var(--brand-text-muted)',
    border: 'var(--brand-border)',
  },
}

const BADGE_FONT_SIZE_PX = 12

export const Badge = ({ tone = 'neutral', children }: BadgeProps): ReactElement => {
  const palette = TONE_PALETTES[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        padding: '2px var(--space-2)',
        borderRadius: 'var(--radius-full)',
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontSize: `${String(BADGE_FONT_SIZE_PX)}px`,
        fontWeight: 'var(--font-weight-medium)',
        fontFamily: 'var(--brand-font-family)',
        lineHeight: 'var(--line-height-tight)',
      }}
    >
      {children}
    </span>
  )
}
