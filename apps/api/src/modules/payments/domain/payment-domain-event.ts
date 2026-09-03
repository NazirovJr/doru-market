/**
 * Доменные события `payments` (EP-10, DTJ-242, `10-domain-model.md` §«Доменные события»,
 * SRS-DOM-151/152). Зеркалит `orders/domain/order-domain-event.ts` (DTJ-222) — каждый
 * bounded context владеет ФОРМОЙ событий, которые ОН публикует (глоссарий `10-domain-model.md`
 * говорит, кто публикует/потребляет, не где живёт тип).
 *
 * `OrderPaidEvent` — payload 1:1 с глоссарием (`orderId, tenantId, paidAt, paymentMethod,
 * holdAmountDiram, txId`, `10-domain-model.md` строка ~948): публикует `payments`
 * (`HandlePaymentWebhookUseCase`, ЕДИНСТВЕННЫЙ вызывающий код — SRS-PAY-018), потребляют
 * `orders`/`notifications`/`analytics` через `OutboxRelayWorker` (тот же общий `outbox`,
 * `db/schema/outbox.schema.ts`, DTJ-016). `orders.status` при этом меняется СИНХРОННО, в ЭТОЙ
 * же транзакции, через `PaymentsOrdersPort.markPaidEscrow()` (SRS-ORD-027a) — публикация этого
 * события НЕ является механизмом смены статуса заказа, только уведомлением сторонних
 * подписчиков (см. JSDoc `HandlePaymentWebhookUseCase`).
 *
 * `holdAmountDiram` — `string`, не `bigint`: `outbox.payload` — `jsonb`
 * (`db/schema/outbox.schema.ts`), `JSON.stringify` не умеет сериализовать `bigint`
 * (`TypeError`) — тот же приём, что `MockBankAutoPayJobData.amountDiram` (`mock-bank.
 * provider.ts`, BullMQ/Redis-сериализация).
 */

export interface OrderPaidEvent {
  readonly type: 'OrderPaidEvent'
  readonly orderId: string
  readonly tenantId: string
  readonly paidAt: Date
  readonly paymentMethod: string
  readonly holdAmountDiram: string
  readonly txId: string
}

export type PaymentsDomainEvent = OrderPaidEvent
