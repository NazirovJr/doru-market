// Сужение InventoryFacade (useExisting в admin.module.ts) до методов, нужных admin.
export const INVENTORY_FACADE_PORT = Symbol.for('@dorutj/admin/inventory-facade-port')

export interface InventorySummaryView {
  readonly skuCount: number
  readonly staleDataSharePercent: number
}

// DTJ-365: CRUD API-ключей 1С аптеки — секрет виден клиенту ТОЛЬКО в CreatedPharmacyApiKeyView.
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
  readonly createdAt: Date
}

export interface InventoryFacadePort {
  getInventorySummary(pharmacyId: string): Promise<InventorySummaryView>
  createPharmacyApiKey(pharmacyId: string): Promise<CreatedPharmacyApiKeyView>
  listPharmacyApiKeys(pharmacyId: string): Promise<readonly PharmacyApiKeySummaryView[]>
  revokePharmacyApiKey(pharmacyId: string, keyId: string, reason: string): Promise<boolean>
}
