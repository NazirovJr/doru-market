/**
 * Доменные события `Order` (EP-09, DTJ-222, SRS-DOM-151) и типы для `order.cancel()`.
 *
 * Минимальный payload — только то, чем реально владеет `Order` на момент мутации. Обогащение
 * (например, публикация в `outbox` в той же транзакции) — забота вызывающего use case, вне
 * периметра DTJ-221/222 (чистый домен/application, без БД).
 *
 * Не каждый метод-намерение эмитирует событие: `markPaidEscrow`/`markDelivered` — по глоссарию
 * `10-domain-model.md` §«Доменные события», `OrderPaidEvent`/`OrderDeliveredEvent` публикуют
 * `payments`/`delivery` соответственно, не `orders` — см. комментарии в `order.entity.ts`.
 */

export type OrderDomainEvent =
  | { readonly type: 'OrderConfirmedEvent'; readonly orderId: string; readonly at: Date }
  | {
      readonly type: 'OrderProcessingStartedEvent'
      readonly orderId: string
      readonly pharmacistId: string
      readonly slaDeadlineAt: Date
    }
  | { readonly type: 'OrderPickedUpEvent'; readonly orderId: string; readonly handoverOtpId: string; readonly at: Date }
  | {
      readonly type: 'OrderCancelledEvent'
      readonly orderId: string
      readonly reason: OrderCancelReason
      readonly cancelledBy: string | null
      readonly at: Date
    }

/** SRS-ORD-030 — канонический enum причин отмены (не свободная строка). */
export const ORDER_CANCEL_REASON_VALUES = [
  'customer_changed_mind',
  'found_cheaper_elsewhere',
  'pharmacy_suspended',
  'payment_timeout',
  'pickup_sla_timeout',
  'fraud_or_safety_force_cancel',
  'license_revoked_force_cancel',
  'late_payment_after_cancellation',
] as const
export type OrderCancelReason = (typeof ORDER_CANCEL_REASON_VALUES)[number]

/** `orders.cancelled_by` — `null` для системных/джоба-инициированных отмен. */
export type OrderCancelActor = { readonly kind: 'user'; readonly userId: string } | { readonly kind: 'system' }
