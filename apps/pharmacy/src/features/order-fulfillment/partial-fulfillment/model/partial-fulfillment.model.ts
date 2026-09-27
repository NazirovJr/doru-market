/** Статус частичной сборки (DTJ-312 доработка) — выведен из `order.partialFulfillment` (`GET /orders/:id`), не из клиентской эвристики (foundIssue приёмки: сравнение `totalAmountDiram` меняется и по другим причинам). */
import type { PharmacyTerminalOrderDetailDto, PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import { areAllItemsResolved, hasUnavailableItem } from '@/features/order-fulfillment/model/picking.model'

export type PartialFulfillmentUiStatus = 'idle' | 'awaiting' | 'resolved'

type PartialFulfillmentField = PharmacyTerminalOrderDetailDto['partialFulfillment']

/** `awaiting_customer` — ждём клиента; `null`/`confirmed`/`auto_confirmed_timeout`/`rejected` — предлагать нечего/уже решилось (отказ отменяет заказ целиком, см. `isOrderCancelled`/`OrderCancelledDialog`, здесь не дублируется). */
export function derivePartialFulfillmentUiStatus(partialFulfillment: PartialFulfillmentField): PartialFulfillmentUiStatus {
  if (partialFulfillment === null) return 'idle'
  return partialFulfillment.status === 'awaiting_customer' ? 'awaiting' : 'resolved'
}

export function canProposePartialFulfillment(
  items: readonly PharmacyTerminalOrderItemDto[],
  status: PartialFulfillmentUiStatus,
): boolean {
  return areAllItemsResolved(items) && hasUnavailableItem(items) && status === 'idle'
}

/** Таблица истинности (все решены × наличие unavailable × статус запроса) — тест-план DTJ-312. */
export function canCompletePicking(items: readonly PharmacyTerminalOrderItemDto[], status: PartialFulfillmentUiStatus): boolean {
  if (!areAllItemsResolved(items)) return false
  if (!hasUnavailableItem(items)) return true
  return status === 'resolved'
}
