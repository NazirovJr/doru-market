import type { ReactElement, ReactNode } from 'react'
import { formatMoney, type Locale, type TranslateFunction, type TranslationKey } from '@dorutj/i18n'
import { Badge } from '../badge/badge.js'
import { cx } from '../shared/cx.js'
import './savings-badge.css'

/**
 * `catalog.analogs.savings_label` — заведён ЭТИМ тикетом (DTJ-407 п.2, координация с DTJ-402).
 * НЕ переиспользует существующий `catalog.analogs.title_savings` (DTJ-104/402, «Сэкономьте
 * {amount} сомони») — та строка ожидает БЕЗ-суффиксное число (её единственный текущий консьюмер,
 * `apps/web/src/features/analogs/ui/savings-banner.tsx`, форматирует сумму вручную через
 * `Intl.NumberFormat` без валютного слова, т.к. слово уже зашито в саму строку словаря).
 * `SavingsBadge` обязан форматировать деньги через `formatMoney()` (DTJ-402, AGENTS.md §6 — не
 * писать своё деление на 100), а `formatMoney()` САМА добавляет локализованный суффикс валюты —
 * подстановка её результата в `title_savings` дала бы задвоенное «сомони сомони» (поймано тестом
 * при первой реализации). Поэтому параметр `{amount}` этого НОВОГО ключа — уже полностью
 * отформатированная (с суффиксом) строка `formatMoney()`, а сам текст ключа суффикс не повторяет.
 */
const SAVINGS_LABEL_KEY: TranslationKey = 'catalog.analogs.savings_label'

export interface SavingsBadgeProps {
  /** Целые дирамы — форматирование только через `formatMoney()` (DTJ-402), см. `PriceTag`. */
  readonly savingsDiram: number
  readonly locale: Locale
  /** Результат `useT()` у потребителя — тот же приём, что `EmptyState`/`OfflineBanner` (DTJ-406). */
  readonly t: TranslateFunction
  /** ОБЯЗАТЕЛЬНЫЙ (не `?:`) текст-объяснение рядом с цифрой экономии — REQ-UX-1 письменного
   * документа: изолированная цифра экономии без контекста запрещена (тикет DTJ-407 п.2). */
  readonly explanation: ReactNode
  readonly className?: string
}

/** «Сэкономьте N сомони» + ОБЯЗАТЕЛЬНОЕ пояснение, собрано поверх `Badge` (DTJ-404) с
 * `tone="success"` (тикет DTJ-407 п.2). */
export const SavingsBadge = ({ savingsDiram, locale, t, explanation, className }: SavingsBadgeProps): ReactElement => (
  <div className={cx('ui-savings-badge', className)}>
    <Badge tone="success">{t(SAVINGS_LABEL_KEY, { amount: formatMoney(savingsDiram, locale) })}</Badge>
    <p className="ui-savings-badge__explanation">{explanation}</p>
  </div>
)
