/**
 * `PharmacyOfferRow` (DTJ-407, `SRS-UX-002`/`SRS-UX-021`/`SRS-UX-034`) — строка предложения
 * аптеки внутри карточки товара: название, `PriceTag`, расстояние, остаток, кнопка «В корзину».
 *
 * `stopPropagation` (критерий приёмки 5 тикета): эта строка часто рендерится ВНУТРИ интерактивной
 * `Card` (`MedicineCard`) — клик по кнопке «В корзину» ОБЯЗАН не всплывать до клика по всей
 * карточке (иначе клик по кнопке одновременно триггерил бы переход карточки). Останавливать
 * всплытие — ответственность ЭТОГО компонента (не родителя): `MedicineCard` ничего не знает про
 * то, что может оказаться у неё внутри.
 *
 * `isStale`/`minutesAgo` — переиспользует СУЩЕСТВУЮЩИЙ параметризованный ключ
 * `ux.warning.stale_data` («Данные могут быть неактуальны (обновлено {minutesAgo} мин назад).»,
 * `packages/i18n`, DTJ-402/406) — не заводим дубль (AGENTS.md правило 12). Индикатор — ИКОНКА +
 * ТЕКСТ (не только цвет, `SRS-UX-034`), тот же приём, что `OfflineBanner` (DTJ-406).
 *
 * `cart.add_item_cta` — новый ключ этого тикета (в дереве словаря не было готового «В корзину» —
 * `cart.checkout_cta`/`cart.empty_cta` семантически другие CTA той же фичи).
 */
import { type ReactElement, type MouseEvent } from 'react'
import { type Locale, type TranslateFunction } from '@dorutj/i18n'
import { Button } from '../button/button'
import { PriceTag } from '../price-tag/price-tag'

export interface PharmacyOfferRowProps {
  readonly pharmacyName: string
  readonly priceDiram: number
  readonly inStock: boolean
  /** Уже отформатированная строка расстояния («1.2 км») — см. JSDoc `MedicineCard`. */
  readonly distanceLabel?: string
  readonly isStale?: boolean
  /** Обязателен, когда `isStale === true` (параметр интерполяции `ux.warning.stale_data`). */
  readonly minutesAgo?: number
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onAddToCart?: () => void
}

const STALE_ICON_SIZE_PX = 14

const StaleIcon = (): ReactElement => (
  <svg aria-hidden="true" width={STALE_ICON_SIZE_PX} height={STALE_ICON_SIZE_PX} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="var(--brand-warning-text)" strokeWidth="1.3" />
    <path d="M8 4.5v4l2.5 1.5" stroke="var(--brand-warning-text)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const PharmacyOfferRow = ({
  pharmacyName,
  priceDiram,
  inStock,
  distanceLabel,
  isStale = false,
  minutesAgo,
  locale,
  t,
  onAddToCart,
}: PharmacyOfferRowProps): ReactElement => {
  const handleAddToCartClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // См. JSDoc модуля: останавливает всплытие до внешней интерактивной `Card` (критерий приёмки 5).
    event.stopPropagation()
    onAddToCart?.()
  }

  return (
    <div
      data-testid="pharmacy-offer-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        boxSizing: 'border-box',
        padding: 'var(--space-2) 0',
        borderTop: '1px solid var(--brand-border)',
        fontFamily: 'var(--brand-font-family)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--brand-text)' }}>
            {pharmacyName}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <PriceTag amountDiram={priceDiram} locale={locale} />
            {distanceLabel !== undefined && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>{distanceLabel}</span>
            )}
          </div>
          {!inStock && (
            <span data-testid="pharmacy-offer-row-no-stock" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
              {t('catalog.search.no_offers')}
            </span>
          )}
          {isStale && minutesAgo !== undefined && (
            <span
              data-testid="pharmacy-offer-row-stale"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)', color: 'var(--brand-warning-text)' }}
            >
              <StaleIcon />
              {t('ux.warning.stale_data', { minutesAgo })}
            </span>
          )}
        </div>
        <Button variant="secondary" size="md" onClick={handleAddToCartClick} disabled={!inStock}>
          {t('cart.add_item_cta')}
        </Button>
      </div>
    </div>
  )
}
