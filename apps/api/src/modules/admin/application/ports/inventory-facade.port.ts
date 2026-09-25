// Сужение InventoryFacade (useExisting в admin.module.ts) до методов, нужных admin.
export const INVENTORY_FACADE_PORT = Symbol.for('@dorutj/admin/inventory-facade-port')

export interface InventorySummaryView {
  readonly skuCount: number
  readonly staleDataSharePercent: number
}

export interface InventoryFacadePort {
  getInventorySummary(pharmacyId: string): Promise<InventorySummaryView>
}
