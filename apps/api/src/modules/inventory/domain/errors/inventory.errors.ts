/**
 * Каталог доменных ошибок модуля `inventory` (EP-05, DTJ-145).
 *
 * Все ошибки модуля собраны в один файл, чтобы можно было дать архитектору
 * единый обзор «что умеет inventory». Иерархия — от `DomainError` (см. `./domain-error.ts`).
 *
 * Коды ошибок (для 27-module-admin-moderation-onboarding.md SRS-INV-* и
 * D-06/D-07): ниже в комментариях к каждому классу.
 */
import { DomainError } from './domain-error.js'

/** SRS-INV-002: строка синхронизации пуста (нет ни одной позиции). */
export class EmptyInventoryBatchError extends DomainError {
  constructor() {
    super('EMPTY_INVENTORY_BATCH', 'inventory batch must contain at least one row')
  }
}

/** SRS-INV-002: `price` < 0 или `> 1_000_000_000` дирамов; `quantity` < 0. */
export class InvalidInventoryRowError extends DomainError {
  constructor(reason: string) {
    super('INVALID_INVENTORY_ROW', reason)
  }
}

/** SRS-INV-008: штрихкод невалиден по правилам `Barcode.parse` (см. domain-kernel). */
export class InvalidBarcodeError extends DomainError {
  constructor(raw: string) {
    super('INVALID_BARCODE', `barcode is not parseable: ${raw}`)
  }
}

/** SRS-INV-009: штрихкод неоднозначен — соответствует >1 medicine. См. DTJ-147. */
export class AmbiguousBarcodeError extends DomainError {
  constructor(barcode: string, matchedCount: number) {
    super(
      'AMBIGUOUS_BARCODE',
      `barcode ${barcode} matches ${String(matchedCount)} medicines; resolution required`,
    )
  }
}

/** SRS-INV-010: аптека не активна (suspended/revoked/pending). Принимать остатки нельзя. */
export class PharmacyNotActiveError extends DomainError {
  constructor(pharmacyId: string) {
    super('PHARMACY_NOT_ACTIVE', `pharmacy ${pharmacyId} is not active`)
  }
}

/** SRS-INV-011: партия целиком отклонена (одна строка нарушила инвариант). */
export class InventoryBatchRejectedError extends DomainError {
  constructor(public readonly rowIndices: readonly number[]) {
    super(
      'INVENTORY_BATCH_REJECTED',
      `batch rejected; invalid rows: ${rowIndices.join(', ')}`,
    )
  }
}

/**
 * [SRS-DOM-150, DTJ-144] Попытка перевести батч-синхронизации в
 * недопустимый статус FSM. Бросается из `transitionTo` при нарушении
 * `ALLOWED_TRANSITIONS` (например, `completed_* → *` или
 * `queued → completed_*` напрямую). Не «прокидывается» на HTTP
 * как 5xx — это BUG, маппинг в 409 INVALID_STATE_TRANSITION.
 */
export class IllegalBatchStatusTransitionError extends DomainError {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(
      'ILLEGAL_BATCH_STATUS_TRANSITION',
      `illegal batch status transition: ${fromStatus} -> ${toStatus}`,
    )
  }
}
