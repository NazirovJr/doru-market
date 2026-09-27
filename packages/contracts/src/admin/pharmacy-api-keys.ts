import { z } from 'zod'

const REVOKE_REASON_MAX_LENGTH = 500

export const RevokePharmacyApiKeyRequestSchema = z.object({
  reason: z.string().trim().min(1).max(REVOKE_REASON_MAX_LENGTH),
})
export type RevokePharmacyApiKeyRequestDto = z.infer<typeof RevokePharmacyApiKeyRequestSchema>

export const SetPharmacyApiKeyMtlsRequestSchema = z.object({ requireMtls: z.boolean() })
export type SetPharmacyApiKeyMtlsRequestDto = z.infer<typeof SetPharmacyApiKeyMtlsRequestSchema>

/** Ответ create/rotate — единственное место, где секрет возвращается целиком; apiKey = `${keyPrefix}.${secret}`. */
export interface PharmacyApiKeyCreatedDto {
  readonly id: string
  readonly apiKey: string
  readonly hmacSecret: string
  readonly keyPrefix: string
  readonly createdAt: string
}

export interface PharmacyApiKeySummaryDto {
  readonly id: string
  readonly keyPrefix: string
  readonly isActive: boolean
  readonly requireMtls: boolean
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly revokedAt: string | null
}
