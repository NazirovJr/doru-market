/**
 * Тест-сверка каталога `ErrorCode`/`ERROR_HTTP_STATUS` с источниками (DTJ-005, DoD):
 * `docs/spec/12-api-conventions-auth-tenancy.md` §2.1 и `docs/spec/10-domain-model.md`
 * §«Доменные ошибки». Фикстура — явный построчный список кода → HTTP-статуса из ОБОИХ
 * документов; будущее удаление/подмена кода в `errors.ts` уронит этот тест, а не останется
 * незамеченным.
 */
import { describe, expect, it } from 'vitest'
import { ERROR_HTTP_STATUS, ErrorCode } from './errors'

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
  [ErrorCode.BAD_GATEWAY, 502],
  [ErrorCode.SERVICE_UNAVAILABLE, 503],
  [ErrorCode.INVALID_PHONE_FORMAT, 400],
  [ErrorCode.INVALID_COORDINATES, 400],
  [ErrorCode.ORDER_TOTAL_MISMATCH, 400],
  [ErrorCode.INVALID_RESTOCK_QUANTITY, 400],
  [ErrorCode.INVALID_PRICE, 400],
  [ErrorCode.MISSING_RESOLUTION_REASON, 400],
  [ErrorCode.AMBIGUOUS_DATE_FORMAT, 400],
  [ErrorCode.TENANT_SLUG_TAKEN, 409],
  [ErrorCode.DOMAIN_TAKEN, 409],
  [ErrorCode.RETURN_ALREADY_ACTIVE, 409],
  [ErrorCode.DISPUTE_ALREADY_ACTIVE, 409],
  [ErrorCode.LEDGER_IMBALANCE, 409],
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
  [ErrorCode.PHARMACY_SUSPENDED, 403],
  [ErrorCode.CASH_AMOUNT_MISMATCH, 422],
  [ErrorCode.COURIER_TENANT_MISMATCH, 403],
  [ErrorCode.COURIER_NOT_ELIGIBLE, 422],
  [ErrorCode.SELF_DEALING_FORBIDDEN, 403],
  [ErrorCode.TENANT_CONFIRMATION_PENDING, 409],
  [ErrorCode.PAYOUT_ON_HOLD, 409],
  [ErrorCode.UNAUTHORIZED_ADJUSTMENT, 403],
  [ErrorCode.OTP_EXPIRED, 400],
  [ErrorCode.OTP_MISMATCH, 400],
  [ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, 503],
  [ErrorCode.OCR_PROVIDER_UNAVAILABLE, 503],
  [ErrorCode.SMS_PROVIDER_UNAVAILABLE, 503],
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
