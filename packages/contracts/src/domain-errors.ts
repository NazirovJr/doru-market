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

/**
 * [DTJ-142 + DTJ-156, SRS-ADM-046, EP-05] Запрос от 1С/ERP предъявил
 * `pharmacy_api_key` со scope `chain_id`, но `pharmacy_id` в payload
 * не входит в указанную сеть. `chain_id` ключ авторизует ЛЮБУЮ аптеку
 * сети, поэтому такое несоответствие — попытка атаки или ошибка
 * конфигурации ключа. Возвращаем 403 `PHARMACY_NOT_IN_CHAIN_SCOPE`,
 * без раскрытия `chain_id` клиенту (SRS-NFR-053: не палим ID
 * не-своих тенантов/сетей).
 */
export class PharmacyNotInChainScopeError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(
      ErrorCode.PHARMACY_NOT_IN_CHAIN_SCOPE,
      'Pharmacy does not belong to the chain scope of the API key',
      details,
    )
  }
}

/**
 * [EP-05, DTJ-156, SRS-API-033] Базовый класс ошибок `PharmacyApiKeyGuard`
 * (D-11, REST push-канал 1С/ERP). Перенесено из
 * `apps/api/src/modules/inventory/presentation/errors/pharmacy-api-key.errors.ts` —
 * `application`-порт `PharmacyApiKeyVerificationPort` бросает эти ошибки, а
 * presentation-слой их ловит; жить в `presentation/` они не могут (правило
 * `application-does-not-know-infrastructure`, вынесено на разблокировку
 * волны 4, docs/05-DEVELOPER-HANDBOOK.md §18).
 */
export abstract class PharmacyApiKeyVerificationError extends SecurityError {}

/** 401 — неверный `keyId` или `secret`. Не раскрывает, ЧТО именно. */
export class PharmacyApiKeyInvalidError extends PharmacyApiKeyVerificationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.PHARMACY_API_KEY_INVALID, 'Invalid pharmacy API key', details)
  }
}

/** 401 — `require_mtls=true`, но `X-SSL-Client-Verify !== SUCCESS`. */
export class MtlsRequiredError extends PharmacyApiKeyVerificationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.MTLS_REQUIRED, 'mTLS required for this API key', details)
  }
}

/** 401 — `|now - timestamp| > PHARMACY_SIGNATURE_WINDOW_SECONDS` (default 300). */
export class PharmacyTimestampOutOfWindowError extends PharmacyApiKeyVerificationError {
  constructor(details?: Record<string, unknown>) {
    super(
      ErrorCode.PHARMACY_TIMESTAMP_OUT_OF_WINDOW,
      'Pharmacy request timestamp out of window',
      details,
    )
  }
}

/** 401 — nonce уже использован (replay). */
export class PharmacyRequestReplayedError extends PharmacyApiKeyVerificationError {
  constructor(details?: Record<string, unknown>) {
    super(
      ErrorCode.PHARMACY_REQUEST_REPLAYED,
      'Pharmacy request nonce already used (replay detected)',
      details,
    )
  }
}

/** 401 — подпись не совпала (MITM, изменённое тело, мусор). */
export class PharmacySignatureInvalidError extends PharmacyApiKeyVerificationError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.PHARMACY_SIGNATURE_INVALID, 'Pharmacy request signature invalid', details)
  }
}

/**
 * [DTJ-025, SRS-API-026/028] Refresh-токен не найден, истёк по `absoluteExpiresAt`,
 * или уже отозван (`revoked_at IS NOT NULL` от logout/logout-all). Не раскрывает
 * причину подробнее (SRS-API-028: «не отличать "никогда не существовал" от
 * "давно истёк и вычищен"»).
 *
 * Маппится в HTTP 401 `REFRESH_TOKEN_INVALID` через `ERROR_HTTP_STATUS`.
 */
export class RefreshTokenInvalidError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.REFRESH_TOKEN_INVALID, 'Refresh token invalid', details)
  }
}

/**
 * [DTJ-025, SRS-API-027] Обнаружено переиспользование refresh-токена: предъявлен
 * токен, чей хеш совпадает с записью, УЖЕ имеющей `rotated_at IS NOT NULL` (звено
 * из ПРОШЛОГО, не текущее). Это сигнал атаки — ВСЕ `auth_sessions` с тем же
 * `family_id` немедленно отзываются (`revokeAllByFamilyId`, DTJ-025 §2.3) и
 * возвращается 401. Логируется отдельным `pino.warn` (НЕ `audit_log`).
 *
 * Маппится в HTTP 401 `REFRESH_TOKEN_REUSE_DETECTED` через `ERROR_HTTP_STATUS`.
 */
export class RefreshTokenReuseDetectedError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.REFRESH_TOKEN_REUSE_DETECTED, 'Refresh token reuse detected', details)
  }
}

/**
 * [EP-01 follow-up, GetMeUseCase, ~DTJ-028.6] JWT-claims прошли верификацию
 * (токен валиден по подписи/exp), но СОСТОЯНИЕ пользователя изменилось:
 * `deletedAt !== null` (SRS-DB-004 soft delete) или `isActive === false`
 * (admin отключил учётку). Токен скомпрометирован и не может быть доверен.
 *
 * Маппится в HTTP 401 `TOKEN_INVALID` через `ERROR_HTTP_STATUS`. Семантически
 * отличается от `RefreshTokenInvalidError` (refresh flow) и
 * `RefreshTokenReuseDetectedError` (атака) тем, что access-токен сам по
 * себе валиден, но subject больше не существует в системе.
 *
 * Не раскрывает причину (`deletedAt` vs `isActive=false`) — чтобы не
 * палить внутреннюю структуру БД через timing/error-code атаку.
 */
export class TokenInvalidatedError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.TOKEN_INVALID, 'Token subject is no longer active', details)
  }
}

// ==================== ForbiddenError → 403 FORBIDDEN ====================

/**
 * [DTJ-026, SRS-API-030] Self-service попытка отозвать чужую `auth_sessions`-запись
 * (`session.userId !== actorUserId`). Маппится в HTTP 403 `FORBIDDEN`.
 *
 * НЕ использовать для ролевой guard-проверки (это `INSUFFICIENT_ROLE`,
 * `SRS-API-039`) и НЕ для cross-tenant (`CROSS_TENANT_ACCESS_DENIED`).
 */
export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super(ErrorCode.FORBIDDEN, message, details)
  }
}

// ==================== Telegram TWA: 401 (SecurityError) ====================

/**
 * [DTJ-027, SRS-API-031 шаг 6] `TelegramInitData` подпись не прошла
 * constant-time сравнение (`computed_hash` ≠ переданный `hash`). Причины:
 * подделан `user.id`, истёкшая подпись, неправильный `bot_token` на стороне
 * клиента, MITM. Маппится в HTTP 401 `INVALID_TELEGRAM_INIT_DATA`.
 */
export class InvalidTelegramInitDataError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.INVALID_TELEGRAM_INIT_DATA, 'Invalid Telegram initData signature', details)
  }
}

/**
 * [DTJ-027, SRS-API-031 шаг 7] `initData` подпись ВАЛИДНА, но `auth_date`
 * старше `now() - TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (ENV, дефолт 300с).
 * Это re-play attack vector: тот же initData нельзя использовать повторно
 * за пределами окна. Маппится в HTTP 401 `TELEGRAM_AUTH_DATE_EXPIRED`.
 *
 * Отдельный код от `INVALID_TELEGRAM_INIT_DATA` (SRS-API-031, «разные
 * причины» — клиент должен отличить «надо перезапросить initData у
 * Telegram» от «подпись сломана, токен не наш»).
 */
export class TelegramAuthDateExpiredError extends SecurityError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.TELEGRAM_AUTH_DATE_EXPIRED, 'Telegram initData auth_date expired', details)
  }
}

// ==================== OtpError (abstract) → 400/423/429 ====================

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
  /**
   * [DTJ-024, SRS-API-022] Конструктор принимает опциональный `messageOverride` —
   * канонический текст ошибки из `packages/i18n` (`ux.error.otp_locked`,
   * см. `docs/spec/30-ux-screens-and-flows.md` §5). Если не передан —
   * используется дефолт 'Too many OTP attempts, code locked' (для обратной
   * совместимости с уже написанными unit-тестами `domain-errors.spec.ts`,
   * см. `packages/contracts/src/domain-errors.spec.ts:102`).
   */
  constructor(details?: Record<string, unknown>, messageOverride?: string) {
    super(ErrorCode.OTP_LOCKED, messageOverride ?? 'Too many OTP attempts, code locked', details)
  }
}

/**
 * [SRS-API-019, DTJ-023] Превышен один из лимитов запроса OTP-кода:
 * cooldown 60s / 10-мин (≤3) / 24-ч (≤10) по телефону или 1-ч (≤20) по IP.
 * Маппится в HTTP 429 `OTP_REQUEST_RATE_LIMITED` через `ERROR_HTTP_STATUS`.
 * `retryAfterSeconds` используется контроллером для `Retry-After` header.
 */
export class OtpRequestRateLimitedError extends OtpError {
  constructor(
    readonly scope: 'phone_cooldown' | 'phone_10min' | 'phone_day' | 'ip_hour',
    readonly retryAfterSeconds: number,
    details?: Record<string, unknown>,
  ) {
    super(
      ErrorCode.OTP_REQUEST_RATE_LIMITED,
      `Too many OTP requests: limit '${scope}' exceeded`,
      { ...(details ?? {}), scope, retryAfterSeconds },
    )
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

/**
 * [DTJ-027, SRS-API-032] Тенант (здесь — нейтральный, R1) не имеет
 * настроенного Telegram-бота. В R1 (DTJ-027) это означает отсутствие
 * `TELEGRAM_BOT_TOKEN_NEUTRAL` ENV; в R3 (White-Label) — отсутствие записи
 * в `tenant_settings.telegram_bot_token_ref`. В ОБОИХ случаях —
 * `503 SERVICE_UNAVAILABLE` (временное состояние конфигурации, не 404).
 *
 * `details.reason = 'telegram_bot_not_configured'` — канонический
 * machine-readable код причины, по которому клиент может отличить «бот не
 * настроен» от «Telegram API лежит» (последнее — `BAD_GATEWAY` 502).
 */
export class TelegramBotNotConfiguredError extends ExternalIntegrationError {
  constructor(details?: Record<string, unknown>) {
    super(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Telegram bot is not configured for this tenant',
      { reason: 'telegram_bot_not_configured', ...details },
    )
  }
}
