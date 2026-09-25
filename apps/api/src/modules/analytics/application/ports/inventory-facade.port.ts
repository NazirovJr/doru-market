// Узкий порт analytics → inventory-активность; реализация композит OnboardingFacade+InventoryFacade (см. адаптер), не useExisting.
export const ANALYTICS_INVENTORY_FACADE_PORT = Symbol.for('@dorutj/analytics/inventory-facade-port')

export interface InventoryFacadePort {
  getActivePharmaciesSendingDataRate(tenantId: string): Promise<number>
}
