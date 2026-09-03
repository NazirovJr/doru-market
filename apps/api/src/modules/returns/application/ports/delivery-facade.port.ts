/**
 * Порт `ReturnsDeliveryPort` (EP-11, DTJ-270, SRS-DOM-055, SRS-RET-005).
 *
 * Межмодульный фасад `returns → delivery` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * ЕДИНСТВЕННЫЙ разрешённый способ, которым `returns` назначает обратный рейс курьера и
 * рассчитывает его стоимость. Прямой импорт `modules/delivery/domain/*`/`modules/delivery/
 * application/*` из `returns` — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). 1:1 паттерн `modules/payments/application/ports/
 * orders-facade.port.ts` (DTJ-236).
 *
 * Модуль `delivery` (EP-13) физически не существует на момент этого тикета (тот же класс
 * зависимости, что `DELIVERY_FACADE_PORT` в `modules/orders/orders.module.ts` —
 * `UnimplementedDeliveryFacadeAdapter`) — реализация добавляется инфраструктурным слоем в
 * DTJ-273/274 (вне периметра этого тикета), здесь только интерфейс.
 *
 * `courierReturnFeeDiram` начисляется ВСЕГДА (SRS-RET-005, `courierReturnFeeApplies: true` в
 * `ReturnFinancialOutcome`, DTJ-272) — `calculateReturnFee` не возвращает `null`/опциональное
 * значение, только `bigint`.
 */
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

/** DI-токен для провайдера `ReturnsDeliveryPort`. */
export const RETURNS_DELIVERY_PORT = Symbol.for('@dorutj/returns/delivery-facade')

export interface ReturnsCourierAssignment {
  readonly courierId: string
  readonly etaMinutes: number | null
}

export interface ReturnsDeliveryPort {
  /** `null` — курьер обратного рейса ещё не назначен/недоступен (не ошибка, use case решает дальше). */
  assignReturnCourier(tenantId: string, returnId: string, tx?: ReturnsUnitOfWorkTx): Promise<ReturnsCourierAssignment | null>

  /** SRS-RET-005: результат всегда `>= 0`, независимо от исхода возврата. */
  calculateReturnFee(tenantId: string, orderId: string): Promise<bigint>
}
