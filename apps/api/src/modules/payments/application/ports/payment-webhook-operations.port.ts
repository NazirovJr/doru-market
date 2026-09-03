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
  /** Чужой/несуществующий `providerRef` ⇒ `null` (SRS-PAY-028, вне ACs этого тикета — используется как defensive guard). */
  findOrderByProviderRef(providerRef: string, tx?: PaymentsUnitOfWorkTx): Promise<OriginalPaymentOperationRef | null>

  /** `true` — строка ВПЕРВЫЕ создана этим вызовом (обработать бизнес-логику); `false` — `idempotency_key` уже существовал (SKIP). */
  recordEventIfNew(input: RecordWebhookEventInput, tx: PaymentsUnitOfWorkTx): Promise<boolean>
}
