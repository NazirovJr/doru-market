/**
 * `OrdersCancellationPort` (DTJ-071) — application-уровень контракта
 * принудительной отмены незавершённых заказов. Временная null-реализация
 * (NullOrdersCancellationAdapter) — реальный адаптер подключается в EP-10.
 */
export const ORDERS_CANCELLATION = Symbol.for('@dorutj/onboarding/orders-cancellation')

export interface ForceCancelResult {
  readonly cancelledOrderIds: readonly string[]
}

export interface OrdersCancellationPort {
  forceCancelIncomplete(pharmacyId: string, reason: string): Promise<ForceCancelResult>
}
