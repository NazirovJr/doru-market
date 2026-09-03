/**
 * Порт `DeliveryFacadePort` (EP-09, DTJ-220, SRS-ORD-018 §2.2 «Расчёт стоимости»).
 *
 * Межмодульный фасад `orders → delivery` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Вызывается
 * на этапе расчёта стоимости группы checkout (SRS-ORD-018 шаг 4e) — `delivery_fee_tjs`
 * заказа берётся из этого порта, не вычисляется внутри `orders`.
 *
 * `GeoPoint` — общий VO `shared-kernel` (`@/shared-kernel/index.js`), не тип, объявленный
 * заново здесь: оба конца порта (orders/delivery) обязаны сходиться на одном представлении
 * координат (широта/долгота WGS-84 с валидацией диапазона), см. `GeoPoint.create`.
 *
 * Реализация — адаптер поверх публичного фасада `modules/delivery/index.ts` (EP-13,
 * `apps/api/src/modules/delivery/**`, ещё не создан на момент DTJ-220 — модуль стартует
 * волной 9, `tickets/00-EPICS.md`). Заводится потребляющим тикетом (`CheckoutUseCase`,
 * DTJ-227/228). Здесь — ТОЛЬКО контракт (DTJ-220, скаффолдинг).
 */
import type { GeoPoint } from '@/shared-kernel/index.js'

/** DI-токен для провайдера `DeliveryFacadePort`. */
export const DELIVERY_FACADE_PORT = Symbol.for('@dorutj/orders/delivery-facade')

export interface DeliveryFacadePort {
  /** Стоимость доставки в целых дирамах (никогда float, правило 6 AGENTS.md). */
  calculateFee(pharmacyGeoPoint: GeoPoint, deliveryGeoPoint: GeoPoint): Promise<bigint>
}
