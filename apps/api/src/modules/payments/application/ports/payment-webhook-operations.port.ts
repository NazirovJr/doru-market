/**
 * Порт `PaymentWebhookOperationsPort` (EP-10, DTJ-242, SRS-DOM-164/165, SRS-PAY-022,
 * `21-module-orders-payments-escrow.md` §5.3) — доступ `HandlePaymentWebhookUseCase` к
 * `payment_operations` (DTJ-236, `db/schema/payments.js`), СВОЙ от `PaymentInvoiceCacheRepositoryPort`
 * (DTJ-241, checkout-сторона, БЕЗ `tx` — не транзакционный кэш-хит) — здесь ОБЯЗАН быть `tx`
 * (SRS-DOM-165: атомарность идемпотентной вставки + бизнес-логики в ОДНОЙ транзакции).
 *
 * Два метода, разный смысл:
 *   1. `findOrderByProviderRef` — ЧТЕНИЕ, резолвит `orderId`/`tenantId` по `providerRef`
 *      исходящей операции (`createInvoice()`/`refund()`, DTJ-238/239 уже создали строку) —
 *      `payment_operations` не несёт `tenant_id` (та же схема, что `escrow_ledger`,
 *      `escrow-ledger-repository.port.ts`), скоуп — ТОЛЬКО через `orders.tenant_id`. Нужен
 *      ДО идемпотентной вставки — `payment_operations.order_id` (FK, NOT NULL) обязан быть
 *      известен ПЕРЕД `recordEventIfNew`.
 *   2. `recordEventIfNew` — ИДЕМПОТЕНТНАЯ ЗАПИСЬ (SRS-DOM-164): `INSERT ... ON CONFLICT
 *      (idempotency_key) DO NOTHING`, `idempotency_key = bankEventId` (ДРУГОЙ стол
 *      идемпотентности, чем `Idempotency-Key`-заголовок checkout, DTJ-242 «Риски» — не путать).
 *      `true` — новая строка (бизнес-логику выполнить), `false` — дубликат (SKIP, `200 OK`
 *      без повторной мутации).
 */
import type { PaymentsUnitOfWorkTx } from './orders-facade.port.js'

export const PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY = Symbol.for('@dorutj/payments/payment-webhook-operations-repository')

export type { PaymentsUnitOfWorkTx }

export interface OriginalPaymentOperationRef {
  readonly orderId: string
  readonly tenantId: string
}

/** 1:1 `VerifiedWebhookPayload.type` (`bank-webhook-verifier.port.ts`). */
export type WebhookOperationType = 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed'

/** Объект-параметр (C5, `max-params` ≤3) — поля одной строки `payment_operations`. */
export interface RecordWebhookEventInput {
  readonly bankEventId: string
  readonly orderId: string
  readonly provider: string
  readonly providerRef: string
  readonly operationType: WebhookOperationType
  readonly succeeded: boolean
  readonly amountDiram: bigint
  readonly rawWebhookPayload: Record<string, unknown>
}

export interface PaymentWebhookOperationsPort {
  /** Чужой/несуществующий `providerRef` ИЛИ `orders.deleted_at IS NOT NULL` (DTJ-243, SRS-PAY-040)
   * ⇒ `null` — soft-deleted заказ трактуется КАК неизвестный платёж, той же веткой. */
  findOrderByProviderRef(providerRef: string, tx?: PaymentsUnitOfWorkTx): Promise<OriginalPaymentOperationRef | null>

  /** `true` — строка ВПЕРВЫЕ создана этим вызовом (обработать бизнес-логику); `false` — `idempotency_key` уже существовал (SKIP). */
  recordEventIfNew(input: RecordWebhookEventInput, tx: PaymentsUnitOfWorkTx): Promise<boolean>

  /**
   * (DTJ-243, SRS-PAY-025) — Given `refund_confirmed`/`refund_failed`, ищет РАНЕЕ созданную
   * строку `payment_operations(operation_type IN ('refund','partial_refund'), provider_ref=:providerRef)`
   * — если НЕ найдена, вебхук трактуется как «неизвестный платёж» (out-of-order/спуфинг), даже
   * если `providerRef` резолвится к реальному заказу через `findOrderByProviderRef` (та же ссылка
   * могла быть переиспользована для другого события).
   *
   * ОТСТУПЛЕНИЕ от буквального текста тикета (зафиксировано, не молчаливо): тикет предписывает
   * ДОПОЛНИТЕЛЬНО фильтровать `status='pending'`. Реализовано БЕЗ этого фильтра — `MockBankProvider.
   * insertRefundOperation` (уже принятый код, DTJ-238) пишет строку РЕФАНДА сразу со `status=
   * 'succeeded'` (мок синхронен, комментарий метода: «refund() — синхронно успешен»), поэтому
   * буквальный `status='pending'` НИКОГДА не совпал бы для мок-провайдера и УЖЕ ПРИНЯТЫЙ e2e-путь
   * `RefundOrderUseCase → PaymentProvider.refund() → авто-вебхук refund_confirmed` начал бы
   * ложно распознаваться как «неизвестный платёж» — регресс поверх принятого DTJ-238/245. Цель
   * проверки («вебхук соответствует РЕАЛЬНО инициированному рефанду, не спуфинг») достигается
   * поиском по `(operation_type, provider_ref)` независимо от статуса. См. отчёт сдачи DTJ-243,
   * раздел `disputed`.
   */
  findRefundOperationRef(providerRef: string, tx?: PaymentsUnitOfWorkTx): Promise<OriginalPaymentOperationRef | null>
}
