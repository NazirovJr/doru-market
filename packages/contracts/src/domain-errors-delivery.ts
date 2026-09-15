/**
 * Часть каталога доменных ошибок (см. `domain-errors.ts`) — вынесена по правилу max-lines
 * (L2 линтер) при слиянии `feat/ep-11-returns-flow` в `development`: добавление возвратных
 * ошибок (DTJ-271/273) продвинуло `domain-errors.ts` за лимит 300 строк. Delivery-классы
 * (модуль 25 §A.9, EP-13, DTJ-313) — самый большой цельный блок с собственным заголовком
 * комментария, поэтому вынесен первым, тем же приёмом, что уже `domain-errors-security.ts`.
 *
 * НЕ реэкспортируется из `domain-errors.ts` (циклический импорт: этот файл импортирует
 * `ConflictError`/`BusinessRuleViolationError` ИЗ `domain-errors.ts`) — тот же приём, что
 * `domain-errors-inventory.ts`/`domain-errors-support.ts`/`domain-errors-pharmacy-terminal.ts`.
 * Реэкспортируется напрямую из `index.ts`. Публичный API пакета не меняется — имена классов
 * идентичны тем, что были в `domain-errors.ts` до выноса.
 *
 * `CourierTenantMismatchError`/`CourierNotEligibleError` (SRS-DOM-037/038) остаются в
 * `domain-errors.ts` — переиспользуются этим модулем без изменений (§A.9 «уже определённые
 * коды»), не дублируются здесь.
 */
import { ErrorCode } from './errors.js'
import { ConflictError, BusinessRuleViolationError } from './domain-errors.js'

export class OfferExpiredError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Delivery offer has expired', details, ErrorCode.OFFER_EXPIRED)
  }
}

export class OfferAlreadyRespondedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Delivery offer has already been responded to', details, ErrorCode.OFFER_ALREADY_RESPONDED)
  }
}

export class AssignmentAlreadyClaimedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Delivery assignment has already been claimed', details, ErrorCode.ASSIGNMENT_ALREADY_CLAIMED)
  }
}

export class ShiftAlreadyActiveError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Courier already has an active shift', details, ErrorCode.SHIFT_ALREADY_ACTIVE)
  }
}

export class RatingAlreadySubmittedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Courier rating has already been submitted for this order', details, ErrorCode.RATING_ALREADY_SUBMITTED)
  }
}

/** SRS-DOM-036, ASSUMPTION (нет готового имени в источнике) — см. JSDoc `ErrorCode.DELIVERY_ASSIGNMENT_ALREADY_ACTIVE`. */
export class DuplicateActiveDeliveryAssignmentError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Order already has a non-terminal delivery assignment',
      details,
      ErrorCode.DELIVERY_ASSIGNMENT_ALREADY_ACTIVE,
    )
  }
}

export class CourierNotOnShiftError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Courier is not on shift', details, ErrorCode.COURIER_NOT_ON_SHIFT)
  }
}

export class CourierMaxConcurrentAssignmentsError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Courier is at maximum concurrent assignment capacity', details, ErrorCode.COURIER_AT_CAPACITY)
  }
}

export class DeliveryZoneNotCoveredError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Delivery address is not covered by any delivery zone', details, ErrorCode.DELIVERY_ZONE_NOT_COVERED)
  }
}

export class DeliveryMinOrderNotMetError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Order total does not meet the minimum for delivery', details, ErrorCode.DELIVERY_MIN_ORDER_NOT_MET)
  }
}

export class ColdChainBagNotConfirmedError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Cold chain bag confirmation is required', details, ErrorCode.COLD_CHAIN_BAG_NOT_CONFIRMED)
  }
}

export class NoActiveShiftError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Courier has no active shift', details, ErrorCode.NO_ACTIVE_SHIFT)
  }
}

export class ActiveAssignmentBlocksShiftEndError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Cannot end shift while an active delivery assignment exists',
      details,
      ErrorCode.ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END,
    )
  }
}

export class ContactAttemptsInsufficientError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Not enough customer contact attempts before marking delivery as failed',
      details,
      ErrorCode.CONTACT_ATTEMPTS_INSUFFICIENT,
    )
  }
}
