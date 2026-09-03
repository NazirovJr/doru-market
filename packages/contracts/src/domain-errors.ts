/**
 * Иерархия доменных ошибок — 1:1 транскрипция дерева из `docs/spec/10-domain-model.md`
 * §«Доменные ошибки» (DTJ-005). Базовый класс `DomainError` — единственная точка входа для
 * `presentation`-слоя (`DomainExceptionFilter`, DTJ-018): `error instanceof DomainError` →
 * `ERROR_HTTP_STATUS[error.code]` + `error.details`.
 *
 * ИСКЛЮЧЕНИЕ ИЗ C17 («один экспорт на файл»): это единый специфицированный каталог доменных
 * ошибок всего проекта (см. `tickets/00-EPICS.md` — файл владения EP-01 навсегда), архитектурно
 * эквивалентен `errors.ts`/`permissions.ts` — сознательное решение, зафиксированное тикетом
 * DTJ-005, не результат лени/недосмотра при код-ревью.
 *
 * Правило кодов у промежуточных классов (`ValidationError`, `ConflictError`, `NotFoundError`,
 * `ForbiddenTransitionError`, `BusinessRuleViolationError`): источник даёт им СОБСТВЕННЫЙ
 * фиксированный HTTP/код (используется, когда более специфичный потомок не подходит) — эти
 * классы конкретны (instantiable). У `SecurityError`/`OtpError`/`ExternalIntegrationError`
 * источник указывает диапазон («401/403», «400/423», «502/503») без единого кода — эти классы
 * оставлены `abstract`, т.к. не имеют однозначного собственного `ErrorCode`.
 */
import { ErrorCode } from './errors.js'
import { DomainError } from './domain-error-base.js'

export { DomainError }

// ==================== ValidationError → 400 VALIDATION_ERROR ====================

export class ValidationError extends DomainError {
  constructor(
    message = 'Validation error',
    details?: Record<string, unknown>,
    code: ErrorCode = ErrorCode.VALIDATION_ERROR,
  ) {
    super(code, message, details)
  }
}

export class InvalidPhoneNumberFormatError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid phone number format', details, ErrorCode.INVALID_PHONE_FORMAT)
  }
}

export class InvalidCoordinatesError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid coordinates', details, ErrorCode.INVALID_COORDINATES)
  }
}

export class InvalidCursorError extends ValidationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details, ErrorCode.INVALID_CURSOR)
  }
}

export class OrderTotalMismatchError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Order total mismatch', details, ErrorCode.ORDER_TOTAL_MISMATCH)
  }
}

/** DTJ-221 (EP-09), SRS-DOM-002 — defensive-проверка «все позиции заказа одной аптеки». */
export class OrderPharmacyMismatchError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Order items belong to more than one pharmacy', details, ErrorCode.ORDER_PHARMACY_MISMATCH)
  }
}

export class InvalidRestockQuantityError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid restock quantity', details, ErrorCode.INVALID_RESTOCK_QUANTITY)
  }
}

export class InvalidPriceError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid price', details, ErrorCode.INVALID_PRICE)
  }
}

export class MissingResolutionReasonError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Missing resolution reason', details, ErrorCode.MISSING_RESOLUTION_REASON)
  }
}

export class AmbiguousDateFormatError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Ambiguous date format', details, ErrorCode.AMBIGUOUS_DATE_FORMAT)
  }
}

// ==================== ConflictError → 409 CONFLICT ====================

export class ConflictError extends DomainError {
  constructor(
    message = 'Resource state conflict',
    details?: Record<string, unknown>,
    code: ErrorCode = ErrorCode.CONFLICT,
  ) {
    super(code, message, details)
  }
}

export class DuplicateTenantSlugError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Tenant slug already taken', details, ErrorCode.TENANT_SLUG_TAKEN)
  }
}

export class DuplicateCustomDomainError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Custom domain already taken', details, ErrorCode.DOMAIN_TAKEN)
  }
}

export class DuplicateActiveReturnError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('An active return already exists', details, ErrorCode.RETURN_ALREADY_ACTIVE)
  }
}

export class DuplicateNonTerminalDisputeError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('A non-terminal dispute already exists', details, ErrorCode.DISPUTE_ALREADY_ACTIVE)
  }
}

export class LedgerImbalanceError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Ledger imbalance detected', details, ErrorCode.LEDGER_IMBALANCE)
  }
}

// ==================== NotFoundError → 404 NOT_FOUND ====================

/** Конкретизация (`MedicineNotFoundError` и т.п.) — на уровне application каждого модуля. */
export class NotFoundError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, 'Resource not found', details)
  }
}

// ==================== ForbiddenTransitionError → 409 INVALID_STATE_TRANSITION ====================

export class ForbiddenTransitionError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.INVALID_STATE_TRANSITION, 'Forbidden state transition', details)
  }
}

export class InvalidOrderStatusTransitionError extends ForbiddenTransitionError {}
export class InvalidPrescriptionTransitionError extends ForbiddenTransitionError {}
export class InvalidOnboardingTransitionError extends ForbiddenTransitionError {}
export class AutomaticReactivationForbiddenError extends ForbiddenTransitionError {}
export class DisputeAfterPayoutRequiresAdjustmentError extends ForbiddenTransitionError {}

// ==================== BusinessRuleViolationError → 422 BUSINESS_RULE_VIOLATION ====================

export class BusinessRuleViolationError extends DomainError {
  constructor(
    message = 'Business rule violated',
    details?: Record<string, unknown>,
    code: ErrorCode = ErrorCode.BUSINESS_RULE_VIOLATION,
  ) {
    super(code, message, details)
  }
}

export class PrescriptionNotVerifiedError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Prescription not verified', details, ErrorCode.PRESCRIPTION_NOT_VERIFIED)
  }
}

export class ControlledSubstanceNotOrderableError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Controlled substance is not orderable', details, ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN)
  }
}

export class ExpiredStockError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Stock is expired', details, ErrorCode.EXPIRED_STOCK)
  }
}

export class CodForbiddenForRxError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Cash on delivery is forbidden for Rx orders', details, ErrorCode.COD_FORBIDDEN_FOR_RX)
  }
}

export class CodLimitExceededError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Cash on delivery limit exceeded', details, ErrorCode.COD_LIMIT_EXCEEDED)
  }
}

export class InsufficientStockError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Insufficient stock', details, ErrorCode.INSUFFICIENT_STOCK)
  }
}

export class RestockConditionsNotMetError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Restock conditions not met', details, ErrorCode.RESTOCK_CONDITIONS_NOT_MET)
  }
}

export class ControlledSubstanceMustBeDestroyedError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Controlled substance must be destroyed, not restocked',
      details,
      ErrorCode.CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED,
    )
  }
}

export class ParentChainNotActiveError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Parent chain is not active', details, ErrorCode.PARENT_CHAIN_NOT_ACTIVE)
  }
}

/** DTJ-227 (EP-09), SRS-ORD-016 — checkout не оставил ни одной заказываемой группы. */
export class NoOrderableItemsError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('No orderable items remain after exclusions', details, ErrorCode.NO_ORDERABLE_ITEMS)
  }
}

export class PharmacySuspendedError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Pharmacy is suspended', details, ErrorCode.PHARMACY_SUSPENDED)
  }
}

export class CashAmountMismatchError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Cash amount mismatch', details, ErrorCode.CASH_AMOUNT_MISMATCH)
  }
}

export class CourierTenantMismatchError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Courier belongs to a different tenant', details, ErrorCode.COURIER_TENANT_MISMATCH)
  }
}

export class CourierNotEligibleError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Courier is not eligible', details, ErrorCode.COURIER_NOT_ELIGIBLE)
  }
}

export class SelfDealingResolutionError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Self-dealing dispute resolution is forbidden', details, ErrorCode.SELF_DEALING_FORBIDDEN)
  }
}

export class TenantConfirmationPendingError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Tenant confirmation is pending', details, ErrorCode.TENANT_CONFIRMATION_PENDING)
  }
}

export class DisputeHoldViolationError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Payout is on hold due to an open dispute', details, ErrorCode.PAYOUT_ON_HOLD)
  }
}


// Продолжение каталога (Security/Forbidden/Telegram/Otp/ExternalIntegration) — вынесено
// в отдельный файл по max-lines (L2 линтер). Публичный API не меняется.
export * from './domain-errors-security.js'
