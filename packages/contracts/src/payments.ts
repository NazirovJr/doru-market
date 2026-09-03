/**
 * Публичные контракты модуля `payments` (EP-10, DTJ-236) — заготовки DTO, наполняются по мере
 * готовности `escrow_ledger`/`payout_schedule`/`payment_operations`-репозиториев (DTJ-243+).
 *
 * Денежные поля — целые дирамы (`*Diram`, `number` на границе JSON — правило 6 AGENTS.md,
 * тот же приём, что `OrderDto`/`OrderItemDto` в `orders.ts`: `bigint` не сериализуется в JSON
 * напрямую, конвертация происходит ИСКЛЮЧИТЕЛЬНО в infrastructure-мапперах, сюда попадает уже
 * целое число). Даты — ISO-8601 UTC-строки.
 */

/** 1:1 с enum `escrow_entry_type` (`db/schema/enums.schema.ts`, `11-database-schema.md` строки 824-827). */
export const ESCROW_ENTRY_TYPE_VALUES = [
  'hold_created',
  'platform_fee_captured',
  'captured_to_pharmacy',
  'refunded_to_customer',
  'partially_refunded',
  'adjustment',
] as const
export type EscrowEntryType = (typeof ESCROW_ENTRY_TYPE_VALUES)[number]

/** 1:1 с enum `escrow_entry_direction` — знак проводки вне `Money` (SRS-DOM-067). */
export const ESCROW_ENTRY_DIRECTION_VALUES = ['debit', 'credit'] as const
export type EscrowEntryDirection = (typeof ESCROW_ENTRY_DIRECTION_VALUES)[number]

/** 1:1 с enum `payout_status`. */
export const PAYOUT_STATUS_VALUES = ['pending', 'due', 'disputed', 'paid', 'reversed'] as const
export type PayoutStatus = (typeof PAYOUT_STATUS_VALUES)[number]

/** 1:1 с enum `payment_operation_type`. */
export const PAYMENT_OPERATION_TYPE_VALUES = [
  'create_bill',
  'refund',
  'partial_refund',
  'capture_preauth',
  'void_preauth',
] as const
export type PaymentOperationType = (typeof PAYMENT_OPERATION_TYPE_VALUES)[number]

/** 1:1 с enum `payment_operation_status`. */
export const PAYMENT_OPERATION_STATUS_VALUES = ['pending', 'succeeded', 'failed'] as const
export type PaymentOperationStatus = (typeof PAYMENT_OPERATION_STATUS_VALUES)[number]

/**
 * `EscrowLedgerEntryDto` (заготовка, DTJ-236) — строка эскроу-леджера для presentation-слоя
 * (`GET /api/v1/orders/:id/ledger`, SRS-PAY-016, будущий тикет). Append-only на стороне БД —
 * DTO читает, не пишет.
 */
export interface EscrowLedgerEntryDto {
  readonly id: string
  readonly orderId: string
  readonly entryType: EscrowEntryType
  readonly direction: EscrowEntryDirection
  readonly amountDiram: number
  readonly paymentTransactionRef: string | null
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly createdAt: string
}

/**
 * `PayoutScheduleDto` (заготовка, DTJ-236) — строка расписания выплат для presentation-слоя
 * (`GET /api/v1/pharmacy-accounts/:id/payouts`, SRS-PAY-038, будущий тикет).
 */
export interface PayoutScheduleDto {
  readonly id: string
  readonly orderId: string
  readonly pharmacyId: string
  readonly status: PayoutStatus
  readonly grossAmountDiram: number
  readonly commissionDiram: number
  readonly netAmountDiram: number
  readonly holdPeriodDays: number
  readonly dueAt: string | null
  readonly heldByDisputeId: string | null
  readonly paidAt: string | null
  readonly payoutBatchRef: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * `PaymentOperationDto` (заготовка, DTJ-236) — строка идемпотентности вызовов `PaymentProvider`
 * (REQ-PAY-8). `rawWebhookPayload` намеренно ОТСУТСТВУЕТ здесь — сырое тело вебхука не
 * пересекает границу presentation (PII-риск, см. `db/schema/payments.ts` комментарий колонки).
 */
export interface PaymentOperationDto {
  readonly id: string
  readonly orderId: string
  readonly operationType: PaymentOperationType
  readonly provider: string
  readonly providerRef: string | null
  readonly status: PaymentOperationStatus
  readonly amountDiram: number
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * `RetryPaymentResponseDto` (DTJ-241, SRS-PAY-041) — ответ `POST
 * /api/v1/orders/:id/retry-payment`: заказ существовал в `pending_payment` БЕЗ
 * `payment_transaction_id` (предыдущая попытка `createInvoice` упала после commit заказа) —
 * повторная попытка создать счёт даёт клиенту НОВЫЙ `qrPayload`/`expiresAt`.
 */
export interface RetryPaymentResponseDto {
  readonly orderId: string
  readonly providerRef: string
  readonly qrPayload: string
  readonly expiresAt: string
}
