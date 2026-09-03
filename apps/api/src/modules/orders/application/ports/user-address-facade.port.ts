/**
 * Порт `UserAddressFacadePort` (EP-09, DTJ-229, «Что сделать» п.1, SRS-DOM-072).
 *
 * Межмодульный фасад `orders → auth` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Проверено
 * перед заведением («Риски» DTJ-229 требует это явно): ни `auth`, ни любой другой модуль не
 * объявляет порт/фасад для чтения `user_addresses` — таблица существует (`0003_users_base.sql`,
 * DTJ-014), но БЕЗ единого потребителя до этого тикета. Минимальный контракт объявлен здесь
 * (DTJ-229), реализация — адаптер поверх `db/schema/user-addresses.ts` (тот же приём, что
 * `CatalogFacadeAdapter` читает `pharmacy_inventory` напрямую параллельно вызову чужого
 * публичного фасада, когда чужой модуль сам не экспортирует нужный метод).
 *
 * `getById` — ЧТЕНИЕ ДАННЫХ (D-EP09-11/16): несуществующий/чужой адрес → `null`, вызывающий
 * (`ResolveDeliveryAddressService`) отвечает `NotFoundError`/`ForbiddenError`, порт не решает
 * это сам. `customerId` — ОБЯЗАТЕЛЬНЫЙ второй параметр (не только `addressId`): адрес обязан
 * принадлежать ИМЕННО оформляющему заказ покупателю (SRS-API-046 — чужой ресурс по id не
 * подтверждается как существующий), тот же приём, что `tenantId` первым параметром у
 * репозиториев (D-EP09-10), только скоуп здесь — по владельцу записи, не по тенанту (`user_
 * addresses` не несёт `tenant_id` в каноническом DDL — адрес принадлежит `users`, который сам
 * тенант-скоупен).
 */
import type { GeoPoint } from '@/shared-kernel/index.js'

/** DI-токен для провайдера `UserAddressFacadePort`. */
export const USER_ADDRESS_FACADE_PORT = Symbol.for('@dorutj/orders/user-address-facade')

export interface UserAddressSnapshot {
  readonly id: string
  readonly addressText: string
  readonly landmarkText: string | null
  /**
   * `null` — доработка при реализации адаптера (`infrastructure/adapters/user-address-facade.
   * adapter.ts`): `user_addresses.latitude`/`longitude` — nullable-колонки (`db/schema/
   * user-addresses.ts`, DTJ-014), адрес может существовать без точного пина (текстовый адрес
   * без геометки). `CalculateOrderCostService`/`DeliveryFacadePort` уже трактуют `null`
   * geo-точку как «доставка без расчёта по расстоянию» (`deliveryFeeDiram = 0`), не как ошибку.
   */
  readonly geoPoint: GeoPoint | null
}

export interface UserAddressFacadePort {
  /** `null`, если адрес не существует ИЛИ принадлежит другому пользователю (чтение, безопасный дефолт). */
  getById(addressId: string, customerId: string): Promise<UserAddressSnapshot | null>
}
