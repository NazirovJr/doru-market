/**
 * `BrandLogo` (DTJ-408, `SRS-UX-010`/`SRS-API-059`) — единственное место в кодовой базе, где
 * разрешено ссылаться на «логотип бренда», не хардкодя его. Читает `logoUrl` ТОЛЬКО из пропа
 * (`tenant.settings.brandLogoUrl`, `SRS-API-059`) — компонент сам не делает fetch, получение
 * бренд-данных — обязанность `app`-слоя bootstrap потребителя.
 *
 * `altText` — ОБЯЗАТЕЛЬНЫЙ проп: потребитель обязан передать интерполированное значение
 * `t('brand.name')` (`SRS-UX-010`), НЕ буквальную строку «DoruTJ» — компонент не хардкодит
 * текст `alt` и не подставляет дефолт сам, чтобы не создать иллюзию i18n там, где его нет.
 *
 * Фоллбэк — встроенный нейтральный SVG-плейсхолдер при отсутствии `logoUrl`/пустой строке ИЛИ
 * ошибке загрузки (`onError`) — никогда не сломанный `<img src="">`.
 */
import { type ReactElement, useState } from 'react'

export interface BrandLogoProps {
  readonly logoUrl?: string
  /** `t('brand.name')` потребителя — см. JSDoc модуля. Не хардкодить буквальный бренд. */
  readonly altText: string
  readonly size?: number
}

const DEFAULT_SIZE_PX = 40

interface PlaceholderProps {
  readonly altText: string
  readonly size: number
}

/** Нейтральная нефирменная иконка (заглушка каталога) — не логотип конкретного бренда. */
const Placeholder = ({ altText, size }: PlaceholderProps): ReactElement => (
  <svg
    role="img"
    aria-label={altText}
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
  >
    <rect x="1" y="1" width="38" height="38" rx="10" fill="var(--brand-bg)" stroke="var(--brand-border)" />
    <path
      d="M20 12v16M12 20h16"
      stroke="var(--brand-text-muted)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
)

export const BrandLogo = ({ logoUrl, altText, size = DEFAULT_SIZE_PX }: BrandLogoProps): ReactElement => {
  const [hasLoadError, setHasLoadError] = useState(false)
  const showFallback = logoUrl === undefined || logoUrl.length === 0 || hasLoadError

  if (showFallback) {
    return <Placeholder altText={altText} size={size} />
  }

  return (
    <img
      src={logoUrl}
      alt={altText}
      width={size}
      height={size}
      style={{ objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
      onError={() => { setHasLoadError(true) }}
    />
  )
}
