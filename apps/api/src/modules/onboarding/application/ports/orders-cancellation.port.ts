/**
 * `OrdersCancellationPort` (DTJ-071) — application-уровень контракта
 * принудительной отмены незавершённых заказов; реализует `OrdersCancellationAdapter`.
 */
export const ORDERS_CANCELLATION = Symbol.for('@dorutj/onboarding/orders-cancellation')

export interface ForceCancelResult {
  readonly cancelledOrderIds: readonly string[]
}

export interface OrdersCancellationPort {
  forceCancelIncomplete(pharmacyId: string, reason: string): Promise<ForceCancelResult>
  /** Только заказы без оплаченного эскроу (`pending_payment`/`confirmed`): рефанд не нужен. */
  cancelUnpaid(pharmacyId: string): Promise<ForceCancelResult>
}
