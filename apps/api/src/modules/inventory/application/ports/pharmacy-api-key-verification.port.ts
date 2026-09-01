/**
 * Порт `PharmacyApiKeyVerificationPort` (EP-05, DTJ-156, SRS-API-033/034).
 *
 * Реализует 10-шаговый алгоритм D-11 из `12-api-conventions-auth-tenancy.md`
 * строки 428-464 для REST push-канала (1С/ERP). Используется в
 * `PharmacyApiKeyGuard` ДО контроллера.
 *
 * **Разделение ответственности (DTJ-156 §5):** guard прокидывает
 * `chainId` дальше, но проверку `pharmacy_guid` тела
 * (`PHARMACY_NOT_IN_CHAIN_SCOPE`) выполняет КОНТРОЛЛЕР (DTJ-157) —
 * там уже есть Zod-валидация и распарсенное тело.
 */

import type { PharmacyApiKeyVerificationError } from '@dorutj/contracts'

export interface PharmacyApiKeyVerificationInput {
  /** `keyId.secret` (после split по первой `.`). */
  readonly keyId: string
  readonly secret: string
  /** UNIX-seconds из `X-Pharmacy-Timestamp`. */
  readonly timestamp: string
  /** Nonce из `X-Pharmacy-Nonce`. */
  readonly nonce: string
  /** Hex-encoded HMAC-SHA256 из `X-Pharmacy-Signature`. */
  readonly signature: string
  readonly method: string
  readonly path: string
  /** Сырые байты тела (ДО Zod-парсинга). */
  readonly rawBody: Buffer
  /** `X-SSL-Client-Verify` от Nginx (если есть). */
  readonly mtlsVerifiedHeader: string | undefined
}

export interface PharmacyApiKeyVerificationResult {
  readonly pharmacyId: string
  readonly chainId: string | null
}

export const PHARMACY_API_KEY_VERIFICATION = Symbol.for(
  '@dorutj/inventory/pharmacy-api-key-verification',
)

export interface PharmacyApiKeyVerificationPort {
  /**
   * Возвращает `{ pharmacyId, chainId }` при успехе.
   * Бросает типизированную `PharmacyApiKeyVerificationError` при ЛЮБОМ
   * из 10 шагов (см. SRS-API-033).
   */
  verify(input: PharmacyApiKeyVerificationInput): Promise<PharmacyApiKeyVerificationResult>
}

/** Re-export для удобства. */
export type { PharmacyApiKeyVerificationError }
