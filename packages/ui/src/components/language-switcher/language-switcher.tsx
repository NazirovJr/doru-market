/**
 * `LanguageSwitcher` (DTJ-408, `SRS-UX-027`) — 3 пилюли `TJ`/`RU`/`EN`. Обязан работать БЕЗ
 * авторизации: не проверяет наличие сессии внутри себя, только вызывает переданный
 * `onChange(locale)` — персистентность (`localStorage`/`PATCH /profile`, DTJ-402) — обязанность
 * потребителя. Активная пилюля — заливка `--brand-primary`, минимум 48×48px (`assertHitArea`,
 * тот же приём hit-slop через `padding`, что `Chip`/`Tabs`).
 *
 * Подписи пилюль — `TJ`/`RU`/`EN`, литералы кода локали (`Locale` из `@dorutj/i18n`), а не
 * переводимый текст: язык всегда подписан на СВОЁМ коде независимо от текущей локали
 * интерфейса (стандартный паттерн переключателя языка) — выводятся из типа `Locale` через
 * `.toUpperCase()`, не отдельным хардкод-массивом строк.
 */
import { type CSSProperties, type ReactElement, useState } from 'react'
import type { Locale } from '@dorutj/i18n'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'

export interface LanguageSwitcherProps {
  readonly currentLocale: Locale
  readonly onChange: (locale: Locale) => void
  /** Доступное имя группы (SRS-UX-034) — например «Выбор языка». */
  readonly 'aria-label': string
}

/** Порядок пилюль — фиксирован (не зависит от текущей локали интерфейса). */
const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PILL_CONTENT_SIZE_PX = 32
const PILL_PADDING_PX = (MIN_HIT_AREA_PX - PILL_CONTENT_SIZE_PX) / 2

const GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  gap: 'var(--space-1)',
}

interface LocalePillProps {
  readonly locale: Locale
  readonly selected: boolean
  readonly onClick: () => void
}

const LocalePill = ({ locale, selected, onClick }: LocalePillProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [isFocused, setIsFocused] = useState(false)
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'content-box',
    width: `${String(PILL_CONTENT_SIZE_PX)}px`,
    height: `${String(PILL_CONTENT_SIZE_PX)}px`,
    padding: `${String(PILL_PADDING_PX)}px`,
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-xs)',
    fontFamily: 'var(--brand-font-family)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    background: selected ? 'var(--brand-primary)' : 'var(--brand-surface)',
    color: selected ? 'var(--brand-surface)' : 'var(--brand-text)',
    border: selected ? '1px solid transparent' : '1px solid var(--brand-border)',
    // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
    outline: isFocused ? 'none' : undefined,
    boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
    transition: buildTransition(['background', 'box-shadow'], prefersReducedMotion),
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      onFocus={() => { setIsFocused(true) }}
      onBlur={() => { setIsFocused(false) }}
      style={style}
    >
      {locale.toUpperCase()}
    </button>
  )
}

export const LanguageSwitcher = ({
  currentLocale,
  onChange,
  'aria-label': ariaLabel,
}: LanguageSwitcherProps): ReactElement => (
  <div role="group" aria-label={ariaLabel} style={GROUP_STYLE}>
    {LOCALES.map((locale) => (
      <LocalePill
        key={locale}
        locale={locale}
        selected={locale === currentLocale}
        onClick={() => { onChange(locale) }}
      />
    ))}
  </div>
)
