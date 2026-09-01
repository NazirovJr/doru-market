/**
 * `CurrencyMismatchError` (EP-01, DTJ-007, SRS-DOM-068) — попытка арифметики
 * или сравнения `Money` разных валют. Программная ошибка вызывающего кода
 * (не пользовательский ввод), 400 + `VALIDATION_ERROR` с `details.reason`
 * для observability.
 *
 * Не заводим отдельный `ErrorCode.CURRENCY_MISMATCH` — в SRS-реестре нет
 * явного кода (см. DTJ-007 §«Риски»), а валидировать арифметику валют на
 * UI-уровне невозможно (это runtime invariant). Подробнее в JSDoc тикета.
 */
import { ErrorCode, ValidationError } from '@dorutj/contracts'

const REASON = 'currency_mismatch'

export class CurrencyMismatchError extends ValidationError {
  constructor(
    readonly expectedCurrency: string,
    readonly actualCurrency: string,
    readonly operation: 'add' | 'subtract' | 'equals' | 'isGreaterThan' | 'isLessThan' | 'isLessThanOrEqual' | 'isGreaterThanOrEqual',
  ) {
    super(
      `Cannot ${operation} Money with currency "${actualCurrency}" against "${expectedCurrency}"`,
      { reason: REASON, expectedCurrency, actualCurrency, operation },
      ErrorCode.VALIDATION_ERROR,
    )
  }
}
