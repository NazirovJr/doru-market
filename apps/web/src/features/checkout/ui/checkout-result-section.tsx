import type { ReactElement } from 'react'
import { ErrorCode } from '@dorutj/contracts'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import type { CreateOrderFailedGroup, CreateOrderResponse, CreateOrderResultItem } from '../api/create-order.api'
import { formatCheckoutMoney } from '../model/format-money'

/**
 * `checkout-result-section.tsx` (DTJ-235, AC2) — экран результата `POST /orders` ПОСЛЕ ответа
 * сервера: и оформленные заказы, и провалившиеся группы — ОДНОВРЕМЕННО, ни одно не прячет другое
 * (тикет: «частичный успех... Оба массива могут быть непустыми одновременно... покажи честно»).
 *
 * `resolveFailedGroupReasonKey` — коды ИЗ `ErrorCode` (`@dorutj/contracts/errors.ts`), НЕ
 * строковые литералы в компоненте (правило тикета) — сравнение через `as string`, тот же приём,
 * что `cart-screen.tsx#resolveMutationErrorMessage` (`@typescript-eslint/no-unsafe-enum-comparison`:
 * `FailedGroupResponseDto.reason` — `string` на границе ответа, не сам enum).
 */

function resolveFailedGroupReasonKey(reason: string): string {
  switch (reason) {
    case ErrorCode.PRICE_OR_STOCK_CHANGED as string:
      return 'checkout.failed_group.price_or_stock_changed'
    case ErrorCode.INSUFFICIENT_STOCK as string:
      return 'checkout.failed_group.insufficient_stock'
    case ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN as string:
      return 'checkout.failed_group.controlled_substance_forbidden'
    default:
      return 'checkout.failed_group.generic'
  }
}

function pharmacyLabel(pharmacyId: string, pharmacyNameById: ReadonlyMap<string, string | null>, t: TranslateFunction): string {
  return pharmacyNameById.get(pharmacyId) ?? t('cart.pharmacy_unknown_name')
}

const OrderResultRow = ({
  order,
  pharmacyNameById,
  locale,
  t,
}: {
  readonly order: CreateOrderResultItem
  readonly pharmacyNameById: ReadonlyMap<string, string | null>
  readonly locale: Locale
  readonly t: TranslateFunction
}): ReactElement => (
  <div
    className="rounded-md border border-line p-3"
    data-testid="checkout-result-order"
    data-order-id={order.orderId}
  >
    <p className="text-sm font-semibold text-ink">{pharmacyLabel(order.pharmacyId, pharmacyNameById, t)}</p>
    <p className="text-sm text-ink">
      {t('checkout.result.order_line', { orderNumber: order.orderNumber, amount: formatCheckoutMoney(order.totalAmountDiram, locale) })}
    </p>
    {order.paymentPending ? (
      <p className="text-xs text-ink-muted">{t('checkout.result.payment_pending')}</p>
    ) : null}
  </div>
)

const FailedGroupRow = ({
  group,
  pharmacyNameById,
  t,
}: {
  readonly group: CreateOrderFailedGroup
  readonly pharmacyNameById: ReadonlyMap<string, string | null>
  readonly t: TranslateFunction
}): ReactElement => (
  <div
    role="alert"
    className="rounded-md border border-brand-danger bg-brand-danger/10 p-3"
    data-testid="checkout-result-failed-group"
    data-pharmacy-id={group.pharmacyId}
  >
    <p className="text-sm font-semibold text-brand-danger">{pharmacyLabel(group.pharmacyId, pharmacyNameById, t)}</p>
    <p className="text-sm text-brand-danger">{t(resolveFailedGroupReasonKey(group.reason))}</p>
  </div>
)

export interface CheckoutResultSectionProps {
  readonly result: CreateOrderResponse
  readonly pharmacyNameById: ReadonlyMap<string, string | null>
  readonly locale: Locale
  readonly onContinue: () => void
  readonly t: TranslateFunction
}

export const CheckoutResultSection = ({
  result,
  pharmacyNameById,
  locale,
  onContinue,
  t,
}: CheckoutResultSectionProps): ReactElement => (
  <section data-testid="checkout-result-section" className="flex flex-col gap-4">
    {result.orders.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('checkout.result.orders_title')}</h2>
        {result.orders.map((order) => (
          <OrderResultRow key={order.orderId} order={order} pharmacyNameById={pharmacyNameById} locale={locale} t={t} />
        ))}
      </div>
    )}

    {result.failedGroups.length === 0 ? null : (
      <div className="flex flex-col gap-2" data-testid="checkout-result-failed-groups">
        <h2 className="text-sm font-semibold text-ink">{t('checkout.result.failed_title')}</h2>
        {result.failedGroups.map((group) => (
          <FailedGroupRow key={group.pharmacyId} group={group} pharmacyNameById={pharmacyNameById} t={t} />
        ))}
      </div>
    )}

    <button
      type="button"
      data-testid="checkout-result-continue"
      onClick={onContinue}
      className="inline-flex min-h-12 w-fit items-center justify-center self-center rounded-md bg-brand-primary px-6 font-semibold text-white"
    >
      {t('checkout.result.continue_cta')}
    </button>
  </section>
)
