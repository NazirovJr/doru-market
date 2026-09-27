// Write-порт CRUD ключа 1С (create/list/revoke), только скоуп аптеки (pharmacy_id), не сети.
// rotate/setRequireMtls не заведены — нужны новые колонки схемы, миграция не назначена (см. отчёт).
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
  readonly createdAt: Date
}

export interface PharmacyApiKeysRepository {
  /** Генерирует секрет и argon2-хеш здесь (infrastructure), не в use case. */
  create(pharmacyId: string): Promise<CreatedPharmacyApiKey>
  listByPharmacy(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]>
  /** `false` — не найдено/чужая аптека/уже отозван (pharmacyId проверяется прямо в запросе). */
  revoke(pharmacyId: string, keyId: string, reason: string): Promise<boolean>
}
