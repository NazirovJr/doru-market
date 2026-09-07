import type { ReactElement, ReactNode } from 'react'
import type { Locale } from '@dorutj/i18n'
import { Badge } from '../badge/badge.js'
import { Card } from '../card/card.js'
import { PriceTag } from '../price-tag/price-tag.js'
import { cx } from '../shared/cx.js'
import './medicine-card.css'

/** `control_category` — enum домена (`10-domain-model.md`, D-08), маппинг конкретных значений на
 * `rxBadgeLabel` делает потребитель — этот компонент только решает, показывать ли бейдж
 * (`controlCategory !== 'none'`), не переводит enum в текст (C18, нет бизнес-логики). */
export type MedicineControlCategory = 'none' | 'prescription_only' | 'potent' | 'psychotropic' | 'narcotic'

export interface MedicineCardProps {
  readonly tradeName: string
  readonly innName?: string
  readonly dosageForm?: string
  readonly manufacturerName?: string
  /** Целые дирамы — форматирование через `PriceTag`/`formatMoney` (DTJ-402). */
  readonly priceDiram: number
  readonly locale: Locale
  /** Уже отформатированный текст расстояния — см. `PharmacyOfferRow`. */
  readonly distanceLabel?: ReactNode
  /** Уже отформатированный текст остатка. */
  readonly stockLabel?: ReactNode
  readonly controlCategory: MedicineControlCategory
  /** ОБЯЗАН быть передан, если бейдж должен показаться (`controlCategory !== 'none'`) — текст
   * («Требуется рецепт») приходит от потребителя, не хардкодится здесь (AGENTS.md §9). */
  readonly rxBadgeLabel?: ReactNode
  /** Единый обработчик клика по всей карточке (AC5, тикет DTJ-407 п.4) — `Card` (DTJ-404)
   * `interactive`, кнопка «В корзину» вложенного `PharmacyOfferRow` останавливает всплытие сама. */
  readonly onClick: () => void
  /** Строка(и) предложений аптек (`PharmacyOfferRow`) или другой доп. контент внутри карточки. */
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * Карточка препарата в результатах поиска (`SRS-UX-021`, тикет DTJ-407 п.4). Вся площадь —
 * единая кликабельная зона (`interactive Card`), кроме вложенной кнопки «В корзину».
 */
export const MedicineCard = ({
  tradeName,
  innName,
  dosageForm,
  manufacturerName,
  priceDiram,
  locale,
  distanceLabel,
  stockLabel,
  controlCategory,
  rxBadgeLabel,
  onClick,
  children,
  className,
}: MedicineCardProps): ReactElement => {
  const showRxBadge = controlCategory !== 'none' && rxBadgeLabel !== undefined
  const metaLine = [dosageForm, manufacturerName].filter((part): part is string => Boolean(part)).join(' · ')

  return (
    <Card interactive onClick={onClick} className={cx('ui-medicine-card', className)}>
      <div className="ui-medicine-card__header">
        <div className="ui-medicine-card__identity">
          <p className="ui-medicine-card__trade-name">{tradeName}</p>
          {innName !== undefined ? <p className="ui-medicine-card__inn">{innName}</p> : null}
          {metaLine !== '' ? <p className="ui-medicine-card__meta">{metaLine}</p> : null}
        </div>
        {showRxBadge ? <Badge tone="warning">{rxBadgeLabel}</Badge> : null}
      </div>
      <div className="ui-medicine-card__footer">
        <PriceTag amountDiram={priceDiram} locale={locale} />
        {distanceLabel !== undefined ? <span className="ui-medicine-card__distance">{distanceLabel}</span> : null}
        {stockLabel !== undefined ? <span className="ui-medicine-card__stock">{stockLabel}</span> : null}
      </div>
      {children}
    </Card>
  )
}
