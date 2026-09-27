export const PHARMACY_API_KEYS_REPOSITORY = Symbol.for('@dorutj/inventory/pharmacy-api-keys-repository')

export interface CreatedPharmacyApiKey {
  readonly id: string
  readonly secret: string
  readonly keyPrefix: string
  readonly createdAt: Date
}

export interface PharmacyApiKeySummary {
  readonly id: string
  readonly keyPrefix: string
  readonly isActive: boolean
  readonly requireMtls: boolean
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
  readonly revokedAt: Date | null
}

export interface RotatePharmacyApiKeyParams {
  readonly pharmacyId: string
  readonly oldKeyId: string
  readonly gracePeriodHours: number
  readonly createdByAdminId: string
}

// null/false — не найдено/чужая аптека/уже отозван (условие проверяется прямо в SQL, не отдельным SELECT).
export interface PharmacyApiKeysRepository {
  create(pharmacyId: string, createdByAdminId: string): Promise<CreatedPharmacyApiKey>
  listByPharmacy(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]>
  revoke(pharmacyId: string, keyId: string, reason: string): Promise<boolean>
  rotate(params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKey | null>
  setRequireMtls(pharmacyId: string, keyId: string, requireMtls: boolean): Promise<PharmacyApiKeySummary | null>
  revokeExpiredRotated(keyId: string, now: Date): Promise<boolean>
}
