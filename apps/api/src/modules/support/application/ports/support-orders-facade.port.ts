/**
 * Порт `SupportOrdersFacadePort` (EP-14, DTJ-279, `27-module-admin-moderation-onboarding.md`
 * §6.1, SRS-ADM-053). Межмодульный фасад `support → orders` (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.2) — тонкая обёртка поверх публичного `OrdersFacade`, правило владения
 * `apps/api/src/modules/support/**` допускает обращение к другим модулям только через их фасад.
 *
 * `tenantId` — первый параметр (тот же приём, что все остальные межмодульные порты этой волны —
 * `returns/application/ports/orders-facade.port.ts`, DTJ-270): чужой тенант обязан вести себя
 * как «заказа не существует» (SRS-API-046).
 */

export const SUPPORT_ORDERS_FACADE_PORT = Symbol.for('@dorutj/support/orders-facade')

export interface SupportOrdersFacadePort {
  belongsToCustomer(tenantId: string, orderId: string, customerId: string): Promise<boolean>
}
