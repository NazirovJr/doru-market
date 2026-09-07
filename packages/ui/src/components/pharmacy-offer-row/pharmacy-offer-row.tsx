import { useCallback, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import type { Locale, TranslateFunction, TranslationKey } from '@dorutj/i18n'
import { Button } from '../button/button.js'
import { PriceTag } from '../price-tag/price-tag.js'
import { cx } from '../shared/cx.js'
import './pharmacy-offer-row.css'

/** Ключ уже заведён DTJ-402 (`ux.warning.stale_data`, «Данные могут быть неактуальны (обновлено
 * {minutesAgo} мин назад)») — переиспользуется, не дублируется (тикет DTJ-407 п.5). */
const STALE_KEY: TranslationKey = 'ux.warning.stale_data'

export interface PharmacyOfferRowProps {
  readonly pharmacyName: string
  /** Целые дирамы — форматирование через `PriceTag`/`formatMoney` (DTJ-402). */
  readonly priceDiram: number
  readonly locale: Locale
  /** Уже локализованный/отформатированный текст расстояния (`5 км`/`500 м`) — форматирование
   * единиц измерения вне зоны этого компонента (не бизнес-логика расчёта, а формат числа —
   * `formatNumber`/`formatPluralized`, DTJ-402, ответственность потребителя). */
  readonly distanceLabel?: ReactNode
  /** Уже локализованный текст остатка («в наличии», «осталось 3 шт.») — плюрализация RU/TJ
   * (`SRS-UX-032`) считается потребителем, не этим компонентом. */
  readonly stockLabel?: ReactNode
  /** `SRS-UX-021`/риск тикета: визуальный индикатор устаревания — иконка + текст, НЕ только смена
   * цвета фона строки (тест-план DTJ-407 п.4). */
  readonly isStale?: boolean
  /** Обязателен, если `isStale` — интерполируется в `ux.warning.stale_data` (`{minutesAgo}`). */
  readonly minutesAgo?: number
  readonly t: TranslateFunction
  readonly ctaLabel: ReactNode
  readonly onAddToCart?: () => void
  readonly ctaDisabled?: boolean
  readonly className?: string
}

const StaleIcon = (): ReactElement => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" className="ui-pharmacy-offer-row__stale-icon">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 3.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Строка предложения аптеки в карточке товара (`SRS-UX-021`, тикет DTJ-407 п.5). Кнопка «В
 * корзину» (`Button`, DTJ-404) — `stopPropagation` на клике (AC5: вложена в `MedicineCard`,
 * нажатие на неё не должно триггерить переход/`onClick` карточки-контейнера).
 */
export const PharmacyOfferRow = ({
  pharmacyName,
  priceDiram,
  locale,
  distanceLabel,
  stockLabel,
  isStale = false,
  minutesAgo,
  t,
  ctaLabel,
  onAddToCart,
  ctaDisabled = false,
  className,
}: PharmacyOfferRowProps): ReactElement => {
  const handleAddToCart = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onAddToCart?.()
    },
    [onAddToCart],
  )

  return (
    <div className={cx('ui-pharmacy-offer-row', className)}>
      <div className="ui-pharmacy-offer-row__info">
        <p className="ui-pharmacy-offer-row__name">{pharmacyName}</p>
        <div className="ui-pharmacy-offer-row__meta">
          <PriceTag amountDiram={priceDiram} locale={locale} />
          {distanceLabel !== undefined ? <span className="ui-pharmacy-offer-row__distance">{distanceLabel}</span> : null}
          {stockLabel !== undefined ? <span className="ui-pharmacy-offer-row__stock">{stockLabel}</span> : null}
        </div>
        {isStale ? (
          <p className="ui-pharmacy-offer-row__stale">
            <StaleIcon />
            <span>{t(STALE_KEY, { minutesAgo: minutesAgo ?? 0 })}</span>
          </p>
        ) : null}
      </div>
      <Button variant="secondary" onClick={handleAddToCart} disabled={ctaDisabled} className="ui-pharmacy-offer-row__cta">
        {ctaLabel}
      </Button>
    </div>
  )
}
