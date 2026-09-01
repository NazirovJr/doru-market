/**
 * `InvalidMoneyError` (EP-01, DTJ-007, SRS-DOM-067) — отрицательная сумма,
 * нулевое/отрицательное `multiplyByQuantity(qty)`, отрицательный результат
 * `subtract`, или невалидный decimal-парсинг. Программная ошибка
 * вызывающего кода, 400 + `VALIDATION_ERROR` с `details.reason`.
 *
 * Используется ТОЛЬКО в конструкторе `Money` (через `fromDiram`,
 * `subtract`, `multiplyByQuantity`). Не путать с `ValidationError` из
 * DTO-слоя (SRS-API-001) — здесь про инвариант домена.
 */
import { ErrorCode, ValidationError } from '@dorutj/contracts'

const REASON = 'invalid_money'

export class InvalidMoneyError extends ValidationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { reason: REASON, ...details }, ErrorCode.VALIDATION_ERROR)
  }
}
