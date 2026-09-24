/**
 * `DeliveryTenancyPort` (EP-13, DTJ-314) — порт-обёртка `delivery → tenancy` для чтения
 * `tenant.courierSourcingMode` (SRS-DOM-037/045). 1:1 паттерн `modules/orders/application/ports/
 * tenancy-facade.port.ts` (DTJ-220/228): модуль-локальный узкий порт, а не прямой импорт чужого
 * репозитория в use case — `02` §1.2/1.3.
 */
export const DELIVERY_TENANCY_PORT = Symbol.for('@dorutj/delivery/tenancy-port')

export interface DeliveryTenancyPort {
  /** `own_fleet` / `platform_pool` / `hybrid` (SRS-DOM-045). Неизвестный `tenantId` → `platform_pool`
   * (дефолт `tenants.courier_sourcing_mode`, `db/schema/tenants.ts`) — то же поведение, что база. */
  getCourierSourcingMode(tenantId: string): Promise<'own_fleet' | 'platform_pool' | 'hybrid'>
}
