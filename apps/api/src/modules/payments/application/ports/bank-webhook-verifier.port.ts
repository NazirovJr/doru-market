/**
 * Порт `BankWebhookVerifierPort` (EP-10, DTJ-237, `21-module-orders-payments-escrow.md` §5.2,
 * SRS-PAY-019..021).
 *
 * Резолвится по заголовку `X-Payment-Provider: alif_mobi | dc_next | mock_bank`
 * (`POST /api/v1/payments/webhook`, единственный маршрут, не параметризован по провайдеру в
 * пути — SRS-API-037). ПОЛНОЕ DI-биндинг по ключу провайдера (реестр `providerName →
 * BankWebhookVerifierPort` на случай ОДНОВРЕМЕННО активных нескольких банков) — детали
 * DTJ-239: R1 обслуживает ровно ОДИН `PAYMENT_DRIVER` глобально (SRS-PAY-009), поэтому токен
 * ниже связывается с ЕДИНСТВЕННЫМ активным адаптером (`MockBankWebhookVerifierAdapter`,
 * DTJ-238) — не реестр с несколькими одновременными биндингами.
 *
 * `verify()` — СИНХРОННЫЙ (не `Promise`): HMAC-проверка — чистое CPU-вычисление над уже
 * прочитанными байтами тела и заголовками, без сетевого/дискового I/O ни у одного адаптера
 * (SRS-PAY-020: подпись проверяется ПЕРВЫМ шагом, до `JSON.parse` бизнес-полей).
 */
import type { Result } from '@dorutj/domain-kernel'
import type { InvalidWebhookSignatureError } from '@dorutj/contracts'

/** DI-токен для провайдера `BankWebhookVerifierPort`, активного для текущего `PAYMENT_DRIVER`. */
export const BANK_WEBHOOK_VERIFIER_PORT = Symbol.for('@dorutj/payments/bank-webhook-verifier')

/**
 * Единый внутренний формат ПОСЛЕ адаптер-специфичного парсинга, до бизнес-обработки
 * (SRS-PAY-021) — единственное, что видит `HandlePaymentWebhookUseCase` (DTJ-243),
 * независимо от банка (изоляция бизнес-логики от банк-специфичного формата — цель Provider
 * Pattern).
 */
export interface VerifiedWebhookPayload {
  /** Уникальный ID события на стороне банка — ключ идемпотентности (`payment_operations.idempotency_key`). */
  readonly bankEventId: string
  /** ID счёта/операции, созданного через `createInvoice()`/`refund()`. */
  readonly providerRef: string
  readonly type: 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed'
  readonly amountDiram: bigint
  /** Время события НА СТОРОНЕ БАНКА (для сортировки out-of-order, §5.5). */
  readonly occurredAt: Date
}

export interface BankWebhookVerifierPort {
  verify(rawBody: Buffer, headers: Record<string, string>): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError>
}
