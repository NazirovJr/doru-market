// Сужение InventoryFacade (useExisting в admin.module.ts) до методов, нужных admin.
export const INVENTORY_FACADE_PORT = Symbol.for('@dorutj/admin/inventory-facade-port')

export interface InventorySummaryView {
  readonly skuCount: number
  readonly staleDataSharePercent: number
}

export interface CreatedPharmacyApiKeyView {
  readonly id: string
  readonly secret: string
  readonly keyPrefix: string
  readonly createdAt: Date
}

export interface PharmacyApiKeySummaryView {
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

export interface InventoryFacadePort {
  getInventorySummary(pharmacyId: string): Promise<InventorySummaryView>
  createPharmacyApiKey(pharmacyId: string, createdByAdminId: string): Promise<CreatedPharmacyApiKeyView>
  listPharmacyApiKeys(pharmacyId: string): Promise<readonly PharmacyApiKeySummaryView[]>
  revokePharmacyApiKey(pharmacyId: string, keyId: string, reason: string): Promise<boolean>
  rotatePharmacyApiKey(params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKeyView | null>
  setPharmacyApiKeyMtls(pharmacyId: string, keyId: string, requireMtls: boolean): Promise<PharmacyApiKeySummaryView | null>
}
