/** Клиентское состояние ожидания решения клиента (DTJ-312) — `GET /orders/:id` не несёт статус запроса, WS DTJ-308 ещё нет, поэтому состояние трекается локально и разрешается опросом (см. `resolvePartialFulfillmentUiState`). */
import type { OrderDto, PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import { areAllItemsResolved, hasUnavailableItem } from '@/features/order-fulfillment/model/picking.model'

export type PartialFulfillmentUiState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'awaiting'; readonly totalBeforeDiram: number }
  | { readonly kind: 'resolved' }

export const PARTIAL_FULFILLMENT_IDLE_STATE: PartialFulfillmentUiState = { kind: 'idle' }

export function canProposePartialFulfillment(
  items: readonly PharmacyTerminalOrderItemDto[],
  uiState: PartialFulfillmentUiState,
): boolean {
  return areAllItemsResolved(items) && hasUnavailableItem(items) && uiState.kind === 'idle'
}

/** Таблица истинности (все решены × наличие unavailable × статус запроса) — тест-план DTJ-312. */
export function canCompletePicking(
  items: readonly PharmacyTerminalOrderItemDto[],
  uiState: PartialFulfillmentUiState,
): boolean {
  if (!areAllItemsResolved(items)) return false
  if (!hasUnavailableItem(items)) return true
  return uiState.kind === 'resolved'
}

const CANCELLED_ORDER_STATUS = 'cancelled'

/** Разрешение по опросу `GET /orders/:id`: подтверждение уменьшает `totalAmountDiram` (`recalculateTotals()`), отклонение отменяет заказ целиком — этот случай уже покрыт `isOrderCancelled`/`OrderCancelledDialog`, здесь не дублируется. */
export function resolvePartialFulfillmentUiState(
  uiState: PartialFulfillmentUiState,
  order: Pick<OrderDto, 'status' | 'totalAmountDiram'>,
): PartialFulfillmentUiState {
  if (uiState.kind !== 'awaiting' || order.status === CANCELLED_ORDER_STATUS) {
    return uiState
  }
  return order.totalAmountDiram < uiState.totalBeforeDiram ? { kind: 'resolved' } : uiState
}
