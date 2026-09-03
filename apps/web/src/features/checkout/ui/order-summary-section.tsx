import type { ReactElement } from 'react'
import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import { formatCheckoutMoney } from '../model/format-money'

/**
 * `order-summary-section.tsx` (DTJ-235, «Что сделать» §2) — сводка по аптекам, `meta.
 * pharmacyGroups` из `useCheckoutCart()`.
 *
 * **Доставка НЕ показывается как число.** Дизайн-референт (`.dc.html:906-909`) рисует
 * литеральную сумму («доставка 15 смн»/`checkoutTotal` включает её) — но `CartPharmacyGroupDto`
 * (`@dorutj/contracts`, сверено построчно) НЕ несёт поля стоимости доставки вообще: расчёт
 * (`CalculateOrderCostService`, DTJ-228) — server-only, происходит ВНУТРИ `POST /orders`, клиент
 * до отправки формы физически не знает эту сумму. Рисовать конкретное число значило бы
 * ЛИБО хардкодить фиктивную «15 смн» (запрещено — деньги «целые дирамы, никогда не выдумка»,
 * правило 6 AGENTS.md), ЛИБО дублировать серверную тарифную формулу на клиенте (риск
 * рассинхронизации). Вместо этого — честная сноска `checkout.summary.delivery_note`. См.
 * раздел DISPUTED отчёта сдачи.
 */

export interface OrderSummarySectionProps {
  readonly pharmacyGroups: readonly CartPharmacyGroupDto[]
  readonly locale: Locale
  readonly t: TranslateFunction
}

function sumItemsTotalDiram(groups: readonly CartPharmacyGroupDto[]): number {
  return groups.reduce((sum, group) => sum + group.subtotalDiram, 0)
}

const PharmacyGroupRow = ({
  group,
  locale,
  t,
}: {
  readonly group: CartPharmacyGroupDto
  readonly locale: Locale
  readonly t: TranslateFunction
}): ReactElement => (
  <div
    className="flex items-center justify-between gap-3 rounded-md border border-line p-3"
    data-testid="checkout-summary-group"
    data-pharmacy-id={group.pharmacyId}
  >
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink" data-testid="checkout-summary-group-name">
        {group.pharmacyName ?? t('cart.pharmacy_unknown_name')}
      </p>
      <p className="text-xs text-ink-muted">{t('checkout.summary.pharmacy_items', { count: group.items.length })}</p>
    </div>
    <p className="flex-shrink-0 text-sm font-semibold text-ink" data-testid="checkout-summary-group-subtotal">
      {t('cart.pharmacy_subtotal', { amount: formatCheckoutMoney(group.subtotalDiram, locale) })}
    </p>
  </div>
)

export const OrderSummarySection = ({ pharmacyGroups, locale, t }: OrderSummarySectionProps): ReactElement => {
  const itemsTotalDiram = sumItemsTotalDiram(pharmacyGroups)
  return (
    <section data-testid="checkout-order-summary-section">
      <h2 className="mb-2 text-sm font-semibold text-ink">{t('checkout.summary.title')}</h2>
      <div className="flex flex-col gap-2">
        {pharmacyGroups.map((group) => (
          <PharmacyGroupRow key={group.pharmacyId} group={group} locale={locale} t={t} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{t('checkout.summary.items_total')}</span>
        <span className="text-base font-bold text-ink" data-testid="checkout-summary-items-total">
          {formatCheckoutMoney(itemsTotalDiram, locale)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">{t('checkout.summary.delivery_note')}</p>
    </section>
  )
}
