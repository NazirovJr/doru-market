/**
 * Типы `ReturnFinancialOutcomeResolver` (EP-11, DTJ-272, SRS-RET-004/005).
 */

/**
 * `courierReturnFeeApplies` — литерал `true`, НЕ `boolean`: SRS-RET-005 требует, чтобы курьерская
 * компенсация начислялась ВСЕГДА независимо от исхода (`refused_at_door`/`undeliverable` не
 * возвращают ни `itemsRefund`, ни `deliveryFeeRefund`, но курьеру всё равно платят) — типизация
 * поля как константы `true` делает невозможным случайно закодировать исключение из этого правила
 * в будущем без осознанного изменения самого типа (не значения одного объекта).
 */
export interface ReturnFinancialOutcome {
  readonly itemsRefund: 'full' | 'none'
  readonly deliveryFeeRefund: 'full' | 'none'
  readonly courierReturnFeeApplies: true
}
