/**
 * Каждый класс `domain-errors.ts` — `instanceof DomainError`, корректный `code` (DTJ-005 тест-план).
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode } from './errors.js'
import {
  AmbiguousDateFormatError,
  AutomaticReactivationForbiddenError,
  BusinessRuleViolationError,
  CashAmountMismatchError,
  CodForbiddenForRxError,
  CodLimitExceededError,
  ConflictError,
  ConsentNotGivenError,
  ControlledSubstanceMustBeDestroyedError,
  ControlledSubstanceNotOrderableError,
  CourierNotEligibleError,
  CourierTenantMismatchError,
  DisputeAfterPayoutRequiresAdjustmentError,
  DisputeHoldViolationError,
  DomainError,
  DuplicateActiveReturnError,
  DuplicateCustomDomainError,
  DuplicateNonTerminalDisputeError,
  DuplicateTenantSlugError,
  ExpiredStockError,
  ForbiddenError,
  ForbiddenTransitionError,
  InsufficientStockError,
  InvalidCoordinatesError,
  InvalidCursorError,
  InvalidTelegramInitDataError,
  InvalidOnboardingTransitionError,
  InvalidOrderStatusTransitionError,
  InvalidPhoneNumberFormatError,
  InvalidPrescriptionTransitionError,
  InvalidPriceError,
  InvalidRestockQuantityError,
  InvalidWebhookSignatureError,
  LedgerImbalanceError,
  MissingResolutionReasonError,
  NoOrderableItemsError,
  NotFoundError,
  OcrProviderUnavailableError,
  OrderPharmacyMismatchError,
  OrderTotalMismatchError,
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpMismatchError,
  OtpRequestRateLimitedError,
  ParentChainNotActiveError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  PaymentProviderUnavailableError,
  PharmacyNotInChainScopeError,
  PharmacySuspendedError,
  PrescriptionNotVerifiedError,
  RestockConditionsNotMetError,
  SelfDealingResolutionError,
  SmsProviderUnavailableError,
  TelegramAuthDateExpiredError,
  TelegramBotNotConfiguredError,
  TenantConfirmationPendingError,
  TokenInvalidatedError,
  UnauthorizedAdjustmentError,
  ValidationError,
} from './domain-errors.js'
import {
  BatchNotAvailableForSubstitutionError,
  HandoverOtpNotFoundError,
  ItemAlreadyScannedError,
  ItemNotInOrderError,
  OrderAlreadyClaimedError,
  PendingCustomerConfirmationError,
  SealConfirmationRequiredError,
} from './domain-errors-pharmacy-terminal.js'

/**
 * Полный список concrete-классов публичного каталога ошибок — `./domain-errors.ts` +
 * `./domain-errors-security.ts` (реэкспортирован через `domain-errors.js`) +
 * `./domain-errors-pharmacy-terminal.ts` (DTJ-300, реэкспортируется отдельной строкой из
 * `index.ts`, НЕ через `domain-errors.js` — см. JSDoc файла). Используется тестом ниже, чтобы
 * гарантировать, что каждый concrete-класс покрыт ровно одним кейсом в {@link CASES}. При
 * добавлении новой concrete-ошибки в любой из этих файлов — добавить её сюда и соответствующий
 * кейс в CASES; иначе тест упадёт. Так закрывается рассинхрон «выросло дерево — вырос список
 * тестов».
 *
 * Это замена прежнего магического `toHaveLength(53)`, который был зафиксирован
 * архитектором до волн 2-3 и устарел с добавлением новых классов.
 */
const EXPECTED_CONCRETE_CLASSES: ReadonlySet<string> = new Set<string>([
  'ValidationError',
  'InvalidPhoneNumberFormatError',
  'InvalidCoordinatesError',
  'InvalidCursorError',
  'OrderTotalMismatchError',
  'OrderPharmacyMismatchError',
  'InvalidRestockQuantityError',
  'InvalidPriceError',
  'MissingResolutionReasonError',
  'AmbiguousDateFormatError',
  'ConflictError',
  'DuplicateTenantSlugError',
  'DuplicateCustomDomainError',
  'DuplicateActiveReturnError',
  'DuplicateNonTerminalDisputeError',
  'LedgerImbalanceError',
  'NotFoundError',
  'ForbiddenTransitionError',
  'InvalidOrderStatusTransitionError',
  'InvalidPrescriptionTransitionError',
  'InvalidOnboardingTransitionError',
  'AutomaticReactivationForbiddenError',
  'DisputeAfterPayoutRequiresAdjustmentError',
  'BusinessRuleViolationError',
  'PrescriptionNotVerifiedError',
  'ControlledSubstanceNotOrderableError',
  'ExpiredStockError',
  'CodForbiddenForRxError',
  'CodLimitExceededError',
  'InsufficientStockError',
  'RestockConditionsNotMetError',
  'ControlledSubstanceMustBeDestroyedError',
  'ParentChainNotActiveError',
  'NoOrderableItemsError',
  'PharmacySuspendedError',
  'CashAmountMismatchError',
  'CourierTenantMismatchError',
  'CourierNotEligibleError',
  'SelfDealingResolutionError',
  'TenantConfirmationPendingError',
  'DisputeHoldViolationError',
  'InvalidWebhookSignatureError',
  'ConsentNotGivenError',
  'UnauthorizedAdjustmentError',
  'PharmacyNotInChainScopeError',
  'RefreshTokenInvalidError',
  'RefreshTokenReuseDetectedError',
  'TokenInvalidatedError',
  'ForbiddenError',
  'InvalidTelegramInitDataError',
  'TelegramAuthDateExpiredError',
  'TelegramBotNotConfiguredError',
  'OtpExpiredError',
  'OtpMismatchError',
  'OtpAttemptsExceededError',
  'OtpRequestRateLimitedError',
  'PaymentProviderUnavailableError',
  'OcrProviderUnavailableError',
  'SmsProviderUnavailableError',
  // DTJ-300 (EP-12) — domain-errors-pharmacy-terminal.ts.
  'OrderAlreadyClaimedError',
  'ItemNotInOrderError',
  'ItemAlreadyScannedError',
  'BatchNotAvailableForSubstitutionError',
  'SealConfirmationRequiredError',
  'PendingCustomerConfirmationError',
  'HandoverOtpNotFoundError',
])

/** [конструктор, ожидаемый ErrorCode] — 1:1 дерево `10-domain-model.md` §«Доменные ошибки». */
const CASES: readonly (readonly [() => DomainError, ErrorCode])[] = [
  [() => new ValidationError(), ErrorCode.VALIDATION_ERROR],
  [() => new InvalidPhoneNumberFormatError(), ErrorCode.INVALID_PHONE_FORMAT],
  [() => new InvalidCoordinatesError(), ErrorCode.INVALID_COORDINATES],
  [() => new OrderTotalMismatchError(), ErrorCode.ORDER_TOTAL_MISMATCH],
  [() => new OrderPharmacyMismatchError(), ErrorCode.ORDER_PHARMACY_MISMATCH],
  [() => new InvalidCursorError('cursor shape mismatch'), ErrorCode.INVALID_CURSOR],
  [() => new InvalidRestockQuantityError(), ErrorCode.INVALID_RESTOCK_QUANTITY],
  [() => new InvalidPriceError(), ErrorCode.INVALID_PRICE],
  [() => new MissingResolutionReasonError(), ErrorCode.MISSING_RESOLUTION_REASON],
  [() => new AmbiguousDateFormatError(), ErrorCode.AMBIGUOUS_DATE_FORMAT],
  [() => new ConflictError(), ErrorCode.CONFLICT],
  [() => new DuplicateTenantSlugError(), ErrorCode.TENANT_SLUG_TAKEN],
  [() => new DuplicateCustomDomainError(), ErrorCode.DOMAIN_TAKEN],
  [() => new DuplicateActiveReturnError(), ErrorCode.RETURN_ALREADY_ACTIVE],
  [() => new DuplicateNonTerminalDisputeError(), ErrorCode.DISPUTE_ALREADY_ACTIVE],
  [() => new LedgerImbalanceError(), ErrorCode.LEDGER_IMBALANCE],
  [() => new NotFoundError(), ErrorCode.NOT_FOUND],
  [() => new ForbiddenTransitionError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new InvalidOrderStatusTransitionError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new InvalidPrescriptionTransitionError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new InvalidOnboardingTransitionError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new AutomaticReactivationForbiddenError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new DisputeAfterPayoutRequiresAdjustmentError(), ErrorCode.INVALID_STATE_TRANSITION],
  [() => new BusinessRuleViolationError(), ErrorCode.BUSINESS_RULE_VIOLATION],
  [() => new PrescriptionNotVerifiedError(), ErrorCode.PRESCRIPTION_NOT_VERIFIED],
  [() => new ControlledSubstanceNotOrderableError(), ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN],
  [() => new ExpiredStockError(), ErrorCode.EXPIRED_STOCK],
  [() => new CodForbiddenForRxError(), ErrorCode.COD_FORBIDDEN_FOR_RX],
  [() => new CodLimitExceededError(), ErrorCode.COD_LIMIT_EXCEEDED],
  [() => new InsufficientStockError(), ErrorCode.INSUFFICIENT_STOCK],
  [() => new RestockConditionsNotMetError(), ErrorCode.RESTOCK_CONDITIONS_NOT_MET],
  [() => new ControlledSubstanceMustBeDestroyedError(), ErrorCode.CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED],
  [() => new ParentChainNotActiveError(), ErrorCode.PARENT_CHAIN_NOT_ACTIVE],
  [() => new NoOrderableItemsError(), ErrorCode.NO_ORDERABLE_ITEMS],
  [() => new PharmacySuspendedError(), ErrorCode.PHARMACY_SUSPENDED],
  [() => new CashAmountMismatchError(), ErrorCode.CASH_AMOUNT_MISMATCH],
  [() => new CourierTenantMismatchError(), ErrorCode.COURIER_TENANT_MISMATCH],
  [() => new CourierNotEligibleError(), ErrorCode.COURIER_NOT_ELIGIBLE],
  [() => new SelfDealingResolutionError(), ErrorCode.SELF_DEALING_FORBIDDEN],
  [() => new TenantConfirmationPendingError(), ErrorCode.TENANT_CONFIRMATION_PENDING],
  [() => new DisputeHoldViolationError(), ErrorCode.PAYOUT_ON_HOLD],
  [() => new InvalidWebhookSignatureError(), ErrorCode.INVALID_WEBHOOK_SIGNATURE],
  [() => new ConsentNotGivenError(), ErrorCode.CONSENT_REQUIRED],
  [() => new UnauthorizedAdjustmentError(), ErrorCode.UNAUTHORIZED_ADJUSTMENT],
  [() => new PharmacyNotInChainScopeError(), ErrorCode.PHARMACY_NOT_IN_CHAIN_SCOPE],
  [() => new RefreshTokenInvalidError(), ErrorCode.REFRESH_TOKEN_INVALID],
  [() => new RefreshTokenReuseDetectedError(), ErrorCode.REFRESH_TOKEN_REUSE_DETECTED],
  [() => new TokenInvalidatedError(), ErrorCode.TOKEN_INVALID],
  [() => new ForbiddenError(), ErrorCode.FORBIDDEN],
  [() => new InvalidTelegramInitDataError(), ErrorCode.INVALID_TELEGRAM_INIT_DATA],
  [() => new TelegramAuthDateExpiredError(), ErrorCode.TELEGRAM_AUTH_DATE_EXPIRED],
  [() => new TelegramBotNotConfiguredError(), ErrorCode.SERVICE_UNAVAILABLE],
  [() => new OtpExpiredError(), ErrorCode.OTP_EXPIRED],
  [() => new OtpMismatchError(), ErrorCode.OTP_MISMATCH],
  [() => new OtpAttemptsExceededError(), ErrorCode.OTP_LOCKED],
  [() => new OtpRequestRateLimitedError('phone_cooldown', 60), ErrorCode.OTP_REQUEST_RATE_LIMITED],
  [() => new PaymentProviderUnavailableError(), ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE],
  [() => new OcrProviderUnavailableError(), ErrorCode.OCR_PROVIDER_UNAVAILABLE],
  [() => new SmsProviderUnavailableError(), ErrorCode.SMS_PROVIDER_UNAVAILABLE],
  // DTJ-300 (EP-12) — domain-errors-pharmacy-terminal.ts, 1:1 с таблицей «Новые доменные
  // ошибки» модуля 24.
  [() => new OrderAlreadyClaimedError(), ErrorCode.ORDER_ALREADY_CLAIMED],
  [() => new ItemNotInOrderError(), ErrorCode.ORDER_ITEM_NOT_FOUND],
  [() => new ItemAlreadyScannedError(), ErrorCode.ITEM_ALREADY_SCANNED],
  [() => new BatchNotAvailableForSubstitutionError(), ErrorCode.BATCH_NOT_AVAILABLE],
  [() => new SealConfirmationRequiredError(), ErrorCode.SEAL_CONFIRMATION_REQUIRED],
  [() => new PendingCustomerConfirmationError(), ErrorCode.PARTIAL_FULFILLMENT_PENDING],
  [() => new HandoverOtpNotFoundError(), ErrorCode.HANDOVER_OTP_NOT_FOUND],
]

describe('domain-errors — иерархия 1:1 с 10-domain-model.md', () => {
  it.each(CASES)('instance → instanceof DomainError с кодом %s', (createError, expectedCode) => {
    const error = createError()
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(expectedCode)
  })

  it('покрывает все конкретные классы domain-errors.ts (включая промежуточные конкретные базы)', () => {
    // Реестр concrete-классов должен расти вместе с domain-errors.ts:
    // этот тест ловит рассинхрон между деревом ошибок и таблицей кейсов.
    // Магическое число (раньше 53) заменено на прямую сверку с деревом классов:
    // при добавлении новой concrete-ошибки в domain-errors.ts КЕЙС обязателен.
    const caseConstructors = CASES.map(([createError]) => {
      const sample = createError()
      return sample.constructor.name
    })
    // Каждый кейс должен соответствовать какому-то concrete-классу
    // (защита от опечаток в имени в CASES).
    for (const ctor of caseConstructors) {
      expect(EXPECTED_CONCRETE_CLASSES.has(ctor), `CASES ссылается на отсутствующий класс ${ctor}`).toBe(true)
    }
    // И наоборот: каждый concrete-класс покрыт кейсом.
    for (const cls of EXPECTED_CONCRETE_CLASSES) {
      expect(caseConstructors, `отсутствует кейс для ${cls}`).toContain(cls)
    }
  })

  it('details прокидывается в конструктор и доступен на инстансе', () => {
    const details = { field: 'phone' }
    const error = new InvalidPhoneNumberFormatError(details)
    expect(error.details).toEqual(details)
  })

  it('name инстанса совпадает с именем класса (для логов/трассировки)', () => {
    const error = new InsufficientStockError()
    expect(error.name).toBe('InsufficientStockError')
  })
})

describe('domain-errors-pharmacy-terminal — иерархия (DTJ-300, наследование от подходящего промежуточного класса)', () => {
  it('OrderAlreadyClaimedError/ItemAlreadyScannedError/PendingCustomerConfirmationError — instanceof ConflictError', () => {
    expect(new OrderAlreadyClaimedError()).toBeInstanceOf(ConflictError)
    expect(new ItemAlreadyScannedError()).toBeInstanceOf(ConflictError)
    expect(new PendingCustomerConfirmationError()).toBeInstanceOf(ConflictError)
  })

  it('ItemNotInOrderError/HandoverOtpNotFoundError — instanceof NotFoundError, но с собственным (не NOT_FOUND) кодом', () => {
    const itemNotInOrder = new ItemNotInOrderError({ orderId: 'o1', itemId: 'i1' })
    expect(itemNotInOrder).toBeInstanceOf(NotFoundError)
    expect(itemNotInOrder.code).toBe(ErrorCode.ORDER_ITEM_NOT_FOUND)
    expect(itemNotInOrder.details).toEqual({ orderId: 'o1', itemId: 'i1' })

    const handoverOtpNotFound = new HandoverOtpNotFoundError({ orderId: 'o1' })
    expect(handoverOtpNotFound).toBeInstanceOf(NotFoundError)
    expect(handoverOtpNotFound.code).toBe(ErrorCode.HANDOVER_OTP_NOT_FOUND)
  })

  it('NotFoundError() без аргументов — обратная совместимость: код по умолчанию остаётся NOT_FOUND', () => {
    expect(new NotFoundError().code).toBe(ErrorCode.NOT_FOUND)
    expect(new NotFoundError().message).toBe('Resource not found')
  })

  it('BatchNotAvailableForSubstitutionError — instanceof BusinessRuleViolationError', () => {
    expect(new BatchNotAvailableForSubstitutionError()).toBeInstanceOf(BusinessRuleViolationError)
  })

  it('SealConfirmationRequiredError — instanceof ValidationError', () => {
    expect(new SealConfirmationRequiredError()).toBeInstanceOf(ValidationError)
  })
})
