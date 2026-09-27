// Rotate/requireMtls не заведены — блокер миграции pharmacy_api_keys (см. отчёт сдачи).
import { z } from 'zod'

const REVOKE_REASON_MAX_LENGTH = 500

export const RevokePharmacyApiKeyRequestSchema = z.object({
  reason: z.string().trim().min(1).max(REVOKE_REASON_MAX_LENGTH),
})
export type RevokePharmacyApiKeyRequestDto = z.infer<typeof RevokePharmacyApiKeyRequestSchema>

/** Ответ create — единственное место, где секрет возвращается целиком. */
export interface PharmacyApiKeyCreatedDto {
  readonly id: string
  /** `${keyPrefix}.${secret}` — значение заголовка X-Pharmacy-API-Key целиком. */
  readonly apiKey: string
  readonly hmacSecret: string
  readonly keyPrefix: string
  readonly createdAt: string
}

export interface PharmacyApiKeySummaryDto {
  readonly id: string
  readonly keyPrefix: string
  readonly isActive: boolean
  readonly createdAt: string
}
