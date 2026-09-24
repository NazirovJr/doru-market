/**
 * Тест-сверка каталога `ErrorCode`/`ERROR_HTTP_STATUS` с источниками (DTJ-005, DoD):
 * `docs/spec/12-api-conventions-auth-tenancy.md` §2.1 и `docs/spec/10-domain-model.md`
 * §«Доменные ошибки». Фикстура — явный построчный список кода → HTTP-статуса из ОБОИХ
 * документов; будущее удаление/подмена кода в `errors.ts` уронит этот тест, а не останется
 * незамеченным.
 */
import { describe, expect, it } from 'vitest'
import { ERROR_HTTP_STATUS, ErrorCode } from './errors.js'

/** [код, HTTP-статус] — построчно по таблице §2.1, затем по дереву §«Доменные ошибки». */
const EXPECTED: readonly (readonly [ErrorCode, number])[] = [
  [ErrorCode.VALIDATION_ERROR, 400],
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 400],
  [ErrorCode.INVALID_CURSOR, 400],
  [ErrorCode.TENANT_NOT_RESOLVED, 400],
  [ErrorCode.CONSENT_REQUIRED, 400],
  [ErrorCode.UNAUTHENTICATED, 401],
  [ErrorCode.TOKEN_EXPIRED, 401],
  [ErrorCode.TOKEN_INVALID, 401],
  [ErrorCode.REFRESH_TOKEN_INVALID, 401],
  [ErrorCode.REFRESH_TOKEN_REUSE_DETECTED, 401],
  [ErrorCode.INVALID_TELEGRAM_INIT_DATA, 401],
  [ErrorCode.TELEGRAM_AUTH_DATE_EXPIRED, 401],
  [ErrorCode.PHARMACY_API_KEY_INVALID, 401],
  [ErrorCode.PHARMACY_SIGNATURE_INVALID, 401],
  [ErrorCode.PHARMACY_TIMESTAMP_OUT_OF_WINDOW, 401],
  [ErrorCode.PHARMACY_REQUEST_REPLAYED, 401],
  [ErrorCode.MTLS_REQUIRED, 401],
  [ErrorCode.INVALID_WEBHOOK_SIGNATURE, 401],
  [ErrorCode.FORBIDDEN, 403],
  [ErrorCode.INSUFFICIENT_ROLE, 403],
  [ErrorCode.TENANT_SUSPENDED, 403],
  [ErrorCode.CROSS_TENANT_ACCESS_DENIED, 403],
  [ErrorCode.WS_ROOM_FORBIDDEN, 403],
  [ErrorCode.NOT_FOUND, 404],
  [ErrorCode.UNKNOWN_TENANT_SLUG, 404],
  [ErrorCode.UNSUPPORTED_LOCALE, 404],
  [ErrorCode.REQUEST_TIMEOUT, 408],
  [ErrorCode.CONFLICT, 409],
  [ErrorCode.IDEMPOTENCY_KEY_CONFLICT, 409],
  [ErrorCode.PAYLOAD_TOO_LARGE, 413],
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE, 415],
  [ErrorCode.BUSINESS_RULE_VIOLATION, 422],
  [ErrorCode.OTP_LOCKED, 423],
  [ErrorCode.OTP_REQUEST_RATE_LIMITED, 429],
  [ErrorCode.RATE_LIMITED, 429],
  [ErrorCode.INTERNAL_ERROR, 500],
  // NOT_IMPLEMENTED — DTJ-233 (EP-09): заглушка GET /orders/:id/payment-status до EP-10.
  [ErrorCode.NOT_IMPLEMENTED, 501],
  [ErrorCode.BAD_GATEWAY, 502],
  [ErrorCode.SERVICE_UNAVAILABLE, 503],
  [ErrorCode.INVALID_PHONE_FORMAT, 400],
  [ErrorCode.INVALID_COORDINATES, 400],
  [ErrorCode.ORDER_TOTAL_MISMATCH, 400],
  [ErrorCode.ORDER_PHARMACY_MISMATCH, 400],
  [ErrorCode.INVALID_RESTOCK_QUANTITY, 400],
  [ErrorCode.INVALID_PRICE, 400],
  [ErrorCode.MISSING_RESOLUTION_REASON, 400],
  [ErrorCode.AMBIGUOUS_DATE_FORMAT, 400],
  [ErrorCode.TENANT_SLUG_TAKEN, 409],
  [ErrorCode.DOMAIN_TAKEN, 409],
  [ErrorCode.RETURN_ALREADY_ACTIVE, 409],
  [ErrorCode.DISPUTE_ALREADY_ACTIVE, 409],
  [ErrorCode.LEDGER_IMBALANCE, 409],
  // PRICE_OR_STOCK_CHANGED — DTJ-231 (EP-09), SRS-ORD-023 (21-module-orders-payments-escrow.md
  // §2.2), тот же класс добавления, что NO_ORDERABLE_ITEMS/PAYMENT_METHOD_NOT_ENABLED (D-EP09-9).
  [ErrorCode.PRICE_OR_STOCK_CHANGED, 409],
  // ORDER_NOT_RETRYABLE — DTJ-241 (EP-10), SRS-PAY-041 (21-module-orders-payments-escrow.md,
  // «Что сделать» п.3) — тот же класс добавления, что PRICE_OR_STOCK_CHANGED (D-EP09-9).
  [ErrorCode.ORDER_NOT_RETRYABLE, 409],
  [ErrorCode.INVALID_STATE_TRANSITION, 409],
  [ErrorCode.PRESCRIPTION_NOT_VERIFIED, 422],
  [ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN, 422],
  [ErrorCode.EXPIRED_STOCK, 422],
  [ErrorCode.COD_FORBIDDEN_FOR_RX, 422],
  [ErrorCode.COD_LIMIT_EXCEEDED, 422],
  [ErrorCode.INSUFFICIENT_STOCK, 422],
  [ErrorCode.RESTOCK_CONDITIONS_NOT_MET, 422],
  [ErrorCode.CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED, 422],
  [ErrorCode.PARENT_CHAIN_NOT_ACTIVE, 422],
  // NO_ORDERABLE_ITEMS — DTJ-227 (EP-09), SRS-ORD-016 (00-SRS-MASTER.md:693) — «новый код
  // этого документа» по 21-module-orders-payments-escrow.md §«Ошибки» (строка 202-205), тот же
  // класс добавления, что ORDER_PHARMACY_MISMATCH (D-EP09-9): 10-domain-model.md §«Доменные
  // ошибки» пока НЕ перечисляет его явно — foundIssue, тот же гап документа, что и там.
  [ErrorCode.NO_ORDERABLE_ITEMS, 422],
  // PAYMENT_METHOD_NOT_ENABLED — DTJ-229 (EP-09), SRS-ORD-025 п.2 (21-module-orders-payments-escrow.md:336,
  // «новый код»), тот же класс добавления, что NO_ORDERABLE_ITEMS выше (D-EP09-9).
  [ErrorCode.PAYMENT_METHOD_NOT_ENABLED, 422],
  [ErrorCode.PHARMACY_SUSPENDED, 403],
  [ErrorCode.CASH_AMOUNT_MISMATCH, 422],
  [ErrorCode.COURIER_TENANT_MISMATCH, 403],
  [ErrorCode.COURIER_NOT_ELIGIBLE, 422],
  [ErrorCode.SELF_DEALING_FORBIDDEN, 403],
  [ErrorCode.TENANT_CONFIRMATION_PENDING, 409],
  [ErrorCode.PAYOUT_ON_HOLD, 409],
  [ErrorCode.CHAIN_APPLICATION_ALREADY_EXISTS, 409],
  [ErrorCode.ALREADY_REVIEWED, 409],
  // Delivery — модуль 25 §A.9 (EP-13, DTJ-313). DELIVERY_ASSIGNMENT_ALREADY_ACTIVE — ASSUMPTION,
  // не в таблице §A.9 (см. JSDoc у самого кода в errors.ts), нужен SRS-DOM-036.
  [ErrorCode.OFFER_EXPIRED, 409],
  [ErrorCode.OFFER_ALREADY_RESPONDED, 409],
  [ErrorCode.ASSIGNMENT_ALREADY_CLAIMED, 409],
  [ErrorCode.SHIFT_ALREADY_ACTIVE, 409],
  [ErrorCode.RATING_ALREADY_SUBMITTED, 409],
  [ErrorCode.DELIVERY_ASSIGNMENT_ALREADY_ACTIVE, 409],
  [ErrorCode.COURIER_NOT_ON_SHIFT, 422],
  [ErrorCode.COURIER_AT_CAPACITY, 422],
  [ErrorCode.DELIVERY_ZONE_NOT_COVERED, 422],
  [ErrorCode.DELIVERY_MIN_ORDER_NOT_MET, 422],
  [ErrorCode.COLD_CHAIN_BAG_NOT_CONFIRMED, 422],
  [ErrorCode.NO_ACTIVE_SHIFT, 422],
  [ErrorCode.ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END, 422],
  [ErrorCode.CONTACT_ATTEMPTS_INSUFFICIENT, 422],
  [ErrorCode.UNAUTHORIZED_ADJUSTMENT, 403],
  [ErrorCode.PHARMACY_NOT_IN_CHAIN_SCOPE, 403],
  [ErrorCode.OTP_EXPIRED, 400],
  [ErrorCode.OTP_MISMATCH, 400],
  [ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, 503],
  [ErrorCode.OCR_PROVIDER_UNAVAILABLE, 503],
  [ErrorCode.SMS_PROVIDER_UNAVAILABLE, 503],

  // DTJ-242 (EP-10), SRS-PAY-019 / TC-PAY-005 — docs/spec/21-module-orders-payments-escrow.md.
  [ErrorCode.WEBHOOK_PROVIDER_UNKNOWN, 400],
  // DTJ-271 (EP-11), SRS-RET-003, решение CTO D-EP11-5 (reports/EP11-EP14-CTO-BRIEF.md) —
  // reason='undelivered' переадресуется на SupportFacade/OrderDispute, не создаёт OrderReturn.
  [ErrorCode.UNSUPPORTED_RETURN_REASON, 422],
  // DTJ-273 (EP-11), SRS-RET-012 — окно подачи спора после вручения истекло.
  [ErrorCode.RETURN_WINDOW_EXPIRED, 422],
  // DTJ-275 (EP-11), SRS-API-038 — returnId в пути не резолвится ни в один возврат тенанта.
  [ErrorCode.RETURN_NOT_FOUND, 404],

  // DTJ-300 (EP-12), docs/spec/24-module-pharmacy-terminal.md §«Дополнения к схеме БД»,
  // таблица «Новые доменные ошибки».
  [ErrorCode.ORDER_ALREADY_CLAIMED, 409],
  [ErrorCode.ORDER_ITEM_NOT_FOUND, 404],
  [ErrorCode.ITEM_ALREADY_SCANNED, 409],
  [ErrorCode.BATCH_NOT_AVAILABLE, 422],
  [ErrorCode.SEAL_CONFIRMATION_REQUIRED, 400],
  [ErrorCode.PARTIAL_FULFILLMENT_PENDING, 409],
  [ErrorCode.HANDOVER_OTP_NOT_FOUND, 404],
  // EP-05 inventory (DTJ-160/161) — см. `docs/spec/22-module-inventory-sync-1c.md` SRS-INV-014.
  [ErrorCode.EXCEL_TEMPLATE_HEADER_MISMATCH, 400],
  [ErrorCode.EXCEL_IMPORT_ROW_LIMIT_EXCEEDED, 400],

  // ---- Доменные: модуль support (DTJ-282, EP-14, SRS-ADM-076) ----
  [ErrorCode.TICKET_NOT_FOUND, 404],
  [ErrorCode.TICKET_ALREADY_TERMINAL, 409],
  [ErrorCode.INVALID_TICKET_STATUS_TRANSITION, 409],

  // ---- Доменные: notification_templates (DTJ-369) ----
  [ErrorCode.MISSING_TEMPLATE_VARIABLE, 500],
  [ErrorCode.INVALID_TEMPLATE_SUBJECT_CHANNEL, 400],
  [ErrorCode.CRITICAL_CATEGORY_CANNOT_BE_DISABLED, 422],
]

describe('ErrorCode / ERROR_HTTP_STATUS — сверка с источниками', () => {
  it('содержит ровно те же коды, что и фикстура источников (никто не пропущен и не добавлен лишний)', () => {
    const actual = Object.values(ErrorCode).sort()
    const expected = EXPECTED.map(([code]) => code).sort()
    expect(actual).toEqual(expected)
  })

  it('не содержит дублей по значению', () => {
    const values = Object.values(ErrorCode)
    expect(new Set(values).size).toBe(values.length)
  })

  it.each(EXPECTED)('%s → HTTP %i', (code, expectedStatus) => {
    expect(ERROR_HTTP_STATUS[code]).toBe(expectedStatus)
  })

  it('ERROR_HTTP_STATUS даёт статус для каждого члена ErrorCode', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_HTTP_STATUS[code]).toBeTypeOf('number')
    }
  })
})
