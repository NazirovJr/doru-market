/**
 * `OrderNumberSequenceExhaustedError` (EP-01, DTJ-011, SRS-DOM-085) —
 * эксплуатационный алерт: за день создано > 99999 заказов.
 *
 * Использует `ErrorCode.INTERNAL_ERROR` (нет отдельного кода в SRS-реестре,
 * см. DTJ-011 §«Что сделать» п.5). `details.reason` для observability.
 * HTTP 500 — это НЕ пользовательская ошибка, а сигнал ops о превышении
 * лимита (что означает либо DDoS, либо баг в Redis-счётчике).
 */
import { DomainError, ErrorCode } from '@dorutj/contracts'

const REASON = 'order_number_sequence_exhausted'

export class OrderNumberSequenceExhaustedError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.INTERNAL_ERROR, 'Order number sequence exhausted for this day', {
      reason: REASON,
      ...details,
    })
  }
}
