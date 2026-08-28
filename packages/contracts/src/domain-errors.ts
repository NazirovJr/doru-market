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
import { ErrorCode } from './errors'

export abstract class DomainError extends Error {
  protected constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = new.target.name
  }
}

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

export class OrderTotalMismatchError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Order total mismatch', details, ErrorCode.ORDER_TOTAL_MISMATCH)
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

// ==================== SecurityError (abstract) → 401/403 ====================

export abstract class SecurityError extends DomainError {}

export class InvalidWebhookSignatureError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.INVALID_WEBHOOK_SIGNATURE, 'Invalid webhook signature', details)
  }
}

export class ConsentNotGivenError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.CONSENT_REQUIRED, 'Explicit user consent required', details)
  }
}

export class UnauthorizedAdjustmentError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.UNAUTHORIZED_ADJUSTMENT, 'Unauthorized ledger adjustment', details)
  }
}

// ==================== OtpError (abstract) → 400/423 ====================

export abstract class OtpError extends DomainError {}

export class OtpExpiredError extends OtpError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.OTP_EXPIRED, 'OTP code expired', details)
  }
}

export class OtpMismatchError extends OtpError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.OTP_MISMATCH, 'OTP code mismatch', details)
  }
}

export class OtpAttemptsExceededError extends OtpError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.OTP_LOCKED, 'Too many OTP attempts, code locked', details)
  }
}

// ==================== ExternalIntegrationError (abstract, application-level) → 502/503 ====================

/**
 * Источник (`10-domain-model.md`) явно помечает эту ветку «application-уровень, не domain» —
 * тем не менее классы живут здесь вместе с остальным каталогом (по прямому указанию тикета
 * DTJ-005 шаг 2): `ErrorCode`/`ERROR_HTTP_STATUS` — один общий адресный список на весь проект,
 * заводить для трёх классов отдельный файл было бы дублированием каталога, не разделением слоёв.
 */
export abstract class ExternalIntegrationError extends DomainError {}

export class PaymentProviderUnavailableError extends ExternalIntegrationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, 'Payment provider is unavailable', details)
  }
}

export class OcrProviderUnavailableError extends ExternalIntegrationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.OCR_PROVIDER_UNAVAILABLE, 'OCR provider is unavailable', details)
  }
}

export class SmsProviderUnavailableError extends ExternalIntegrationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.SMS_PROVIDER_UNAVAILABLE, 'SMS provider is unavailable', details)
  }
}
