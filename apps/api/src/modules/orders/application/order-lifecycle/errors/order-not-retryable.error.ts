/**
 * `OrderNotRetryableError` (EP-10, DTJ-241, SRS-PAY-041) — `POST
 * /api/v1/orders/:id/retry-payment` на заказе, который НЕ в `pending_payment` БЕЗ
 * `payment_transaction_id` (уже оплачен через эскроу, наличный, отменён, доставлен...).
 *
 * Канонический код `ORDER_NOT_RETRYABLE` (409, `packages/contracts/src/errors.ts`) — тот же
 * приём, что `checkout/errors/price-or-stock-changed.error.ts`: класс объявлен ЛОКАЛЬНО в
 * модуле, код зарегистрирован централизованно (правило 15 AGENTS.md).
 */
import { ConflictError, ErrorCode } from '@dorutj/contracts'

export class OrderNotRetryableError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Order is not retryable — not pending_payment without a payment transaction', details, ErrorCode.ORDER_NOT_RETRYABLE)
  }
}
