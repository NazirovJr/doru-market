/**
 * Доменные ошибки терминала фармацевта (DTJ-300, EP-12, модуль 24 «Терминал фармацевта»,
 * `docs/spec/24-module-pharmacy-terminal.md` §«Дополнения к схеме БД», таблица «Новые доменные
 * ошибки») — 1:1 транскрипция, домен `orders` (SRS-PHT-001: presentation-поверхность над
 * `orders`, отдельный backend-модуль не заводится).
 *
 * Отдельный файл, НЕ дописано в `domain-errors.ts` (та же причина, что `domain-errors-security.ts`
 * — split по max-lines, DTJ-lint-33: `domain-errors.ts` уже 278 строк, +7 классов превысило бы
 * `max-lines: 300`).
 *
 * ВАЖНОЕ ОТЛИЧИЕ от `domain-errors-security.ts`: эти классы наследуют `ConflictError`/
 * `NotFoundError`/`BusinessRuleViolationError`/`ValidationError` — промежуточные классы,
 * определённые В `domain-errors.ts` (не в `domain-error-base.ts`). Импорт отсюда ОДНОСТОРОННИЙ
 * (этот файл → `domain-errors.ts`) — `domain-errors.ts` этот файл НЕ реэкспортирует (в отличие от
 * `export * from './domain-errors-security.js'` в его хвосте), иначе получился бы цикл
 * `domain-errors.ts` → `domain-errors-pharmacy-terminal.ts` → `domain-errors.ts`, который ломает
 * `class X extends ConflictError` в момент инициализации модуля (тот же класс бага, что
 * `domain-error-base.ts` объясняет про `DomainError`). Публичный API пакета не теряется — барабанный
 * `index.ts` экспортирует ЭТОТ файл отдельной строкой, параллельно `domain-errors.js`, не через него.
 */
import { ErrorCode } from './errors.js'
import { BusinessRuleViolationError, ConflictError, NotFoundError, ValidationError } from './domain-errors.js'
import { DomainError } from './domain-error-base.js'

/** SRS-PHT-009 — заказ уже принят другим фармацевтом (`accept` после чужого `accept`). */
export class OrderAlreadyClaimedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Order is already claimed by another pharmacist', details, ErrorCode.ORDER_ALREADY_CLAIMED)
  }
}

/** SRS-PHT-012 — отсканированный штрихкод резолвится в медикамент, не входящий в эту позицию заказа. */
export class ItemNotInOrderError extends NotFoundError {
  constructor(details?: Record<string, unknown>) {
    super(details, ErrorCode.ORDER_ITEM_NOT_FOUND, 'Scanned item does not belong to this order')
  }
}

/** SRS-PHT-013 — повторное сканирование позиции, уже `scanned_ok`/`unavailable` (не `pending`). */
export class ItemAlreadyScannedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Order item was already scanned or resolved', details, ErrorCode.ITEM_ALREADY_SCANNED)
  }
}

/**
 * SRS-PHT-014 — партия-замена не подходит: другая аптека (`pharmacyInventoryId` не совпадает)
 * ИЛИ недостаточное `quantity` для `orderItem.quantity`. Отдельно от `ExpiredStockError`
 * (переиспользуется как есть, SRS-DOM-006 — просроченная партия ≠ недоступная партия).
 */
export class BatchNotAvailableForSubstitutionError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Batch is not available as a substitution for this order item',
      details,
      ErrorCode.BATCH_NOT_AVAILABLE,
    )
  }
}

/** SRS-PHT-025 — `complete-picking` вызван с `sealConfirmed !== true`. */
export class SealConfirmationRequiredError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Seal confirmation is required to complete picking', details, ErrorCode.SEAL_CONFIRMATION_REQUIRED)
  }
}

/**
 * SRS-PHT-026 п.2 — `complete-picking` вызван, ≥1 позиция `unavailable`, но нет
 * `order_partial_fulfillment_requests` со `status ∈ {'confirmed', 'auto_confirmed_timeout'}` для
 * этого заказа: клиент (или таймаут) ещё не подтвердил изменённый состав.
 */
export class PendingCustomerConfirmationError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Partial fulfillment confirmation from the customer is still pending',
      details,
      ErrorCode.PARTIAL_FULFILLMENT_PENDING,
    )
  }
}

/**
 * SRS-PHT-028 — `GET handover-otp` для заказа, у которого действующего кода вручения больше нет
 * (`status` уже `delivered`, либо код не был сгенерирован). Не путать с `OtpExpiredError`
 * (`OtpError`-потомок) — это отдельная семантика «эндпоинту нечего показать», не «код истёк».
 */
export class HandoverOtpNotFoundError extends NotFoundError {
  constructor(details?: Record<string, unknown>) {
    super(details, ErrorCode.HANDOVER_OTP_NOT_FOUND, 'Handover OTP not found for this order')
  }
}

/**
 * DTJ-306 (SRS-PHT-028, EP-12 §A.5) — `RegenerateHandoverOtpUseCase` отклоняет попытку
 * регенерации: либо `tenant_settings.handover_otp_max_regenerations_per_order` уже исчерпан
 * для заказа, либо `tenant_settings.handover_otp_regenerate_min_interval_seconds` с прошлой
 * регенерации ещё не прошёл. Наследует `DomainError` напрямую (не `BusinessRuleViolationError`
 * — тот мапится в 422, а это 429, отдельный `ErrorCode.RATE_LIMITED`, уже сматппленный
 * `ERROR_HTTP_STATUS`, `errors.ts`).
 */
export class HandoverOtpRegenerationRateLimitedError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.RATE_LIMITED, 'Handover OTP regeneration rate limit exceeded', details)
  }
}
