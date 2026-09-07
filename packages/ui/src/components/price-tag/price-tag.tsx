import type { ReactElement } from 'react'
import { formatMoney, type Locale } from '@dorutj/i18n'
import { cx } from '../shared/cx.js'
import './price-tag.css'

export interface PriceTagProps {
  /** Целые дирамы (`AGENTS.md` §6 — деньги никогда не float). Форматирование — ТОЛЬКО через
   * `formatMoney()` (`@dorutj/i18n`, DTJ-402): деление на 100 происходит один раз, внутри неё, на
   * последнем шаге вывода — этот компонент не повторяет арифметику. */
  readonly amountDiram: number
  readonly locale: Locale
  /** Пара «было/стало» (`SRS-UX-021`): консьюмер рендерит ДВА `PriceTag` рядом — один с
   * `strikethrough` (старая цена), один без (новая). Сам компонент не знает о паре — только
   * визуальный признак «эта цена больше не актуальна» (`<s>`, семантически корректный тег). */
  readonly strikethrough?: boolean
  readonly className?: string
}

/**
 * Крупная контрастная цена (`SRS-UX-002`/`SRS-UX-003`, целевой контраст 7:1 для критичных цифр) —
 * ЕДИНСТВЕННОЕ место форматирования денег для отображения в `packages/ui` (переиспользуется
 * `SavingsBadge`/`AnalogBanner`/`MedicineCard`/`PharmacyOfferRow`, AGENTS.md §12 — не дублировать).
 */
export const PriceTag = ({ amountDiram, locale, strikethrough = false, className }: PriceTagProps): ReactElement => {
  const formatted = formatMoney(amountDiram, locale)
  const classes = cx('ui-price-tag', strikethrough && 'ui-price-tag--strikethrough', className)

  if (strikethrough) {
    return <s className={classes}>{formatted}</s>
  }

  return <span className={classes}>{formatted}</span>
}
