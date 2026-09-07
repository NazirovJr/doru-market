import { useState } from 'react'
import type { ReactElement } from 'react'
import { cx } from '../shared/cx.js'
import './brand-logo.css'

export interface BrandLogoProps {
  /** `tenant.settings.brandLogoUrl` (`SRS-API-059`) — компонент НЕ делает fetch сам, получение
   * значения — обязанность `app`-слоя bootstrap потребителя. */
  readonly logoUrl?: string | undefined
  /** Уже интерполированная строка (`useT('brand.logo_alt', { brand: t('brand.name') })` у
   * потребителя) — компонент не хардкодит буквальное имя бренда (`SRS-UX-010`). */
  readonly alt: string
  readonly className?: string
}

function isBlank(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === ''
}

/**
 * Логотип тенанта (`SRS-UX-021`, единственное разрешённое место кода ссылаться на «логотип
 * бренда» без хардкода — `SRS-UX-010`). Отсутствующий/пустой `logoUrl` ИЛИ ошибка его загрузки
 * (`onError`) → встроенный нейтральный SVG-плейсхолдер, не сломанный `<img>` с пустым `src`.
 */
export const BrandLogo = ({ logoUrl, alt, className }: BrandLogoProps): ReactElement => {
  const [hasLoadError, setHasLoadError] = useState(false)
  const showFallback = isBlank(logoUrl) || hasLoadError

  if (showFallback) {
    return (
      <span role="img" aria-label={alt} className={cx('ui-brand-logo', 'ui-brand-logo--fallback', className)}>
        <FallbackMark />
      </span>
    )
  }

  return (
    <img
      src={logoUrl}
      alt={alt}
      className={cx('ui-brand-logo', className)}
      onError={() => {
        setHasLoadError(true)
      }}
    />
  )
}

const FALLBACK_MARK_SIZE_PX = 32

/** Абстрактная нейтральная метка (не силуэт таблетки/креста, не намёк на конкретный бренд) —
 * геометрическая форма чисто из CSS-переменных, работает как фолбэк для ЛЮБОГО тенанта. */
const FallbackMark = (): ReactElement => (
  <svg width={FALLBACK_MARK_SIZE_PX} height={FALLBACK_MARK_SIZE_PX} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" stroke="currentColor" strokeWidth="2" />
    <circle cx="16" cy="16" r="6" fill="currentColor" />
  </svg>
)
