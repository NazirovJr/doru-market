/**
 * Порт `ReturnsOrdersPort` (EP-11, DTJ-270, `21-module-orders-payments-escrow.md` §7.1).
 *
 * Межмодульный фасад `returns → orders` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) — ЕДИНСТВЕННЫЙ
 * разрешённый способ, которым `returns` читает заказ. Прямой импорт `modules/orders/domain/*`/
 * `modules/orders/application/*` из `returns` — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). 1:1 паттерн `modules/payments/application/ports/
 * orders-facade.port.ts` (DTJ-236): сигнатуры используют ТОЛЬКО примитивы/локальные типы
 * `returns`, никогда доменные VO `orders`.
 *
 * `tenantId` — первый обязательный параметр (тот же приём, что `PaymentsOrdersPort`): чужой
 * тенант обязан вести себя как «заказа не существует» (404), не «доступ запрещён» (403)
 * (SRS-API-043/046).
 *
 * Реализация — тонкий адаптер поверх реального `modules/orders` → `OrdersFacade`, добавляется
 * инфраструктурным слоем в DTJ-273 (вне периметра этого тикета — здесь только интерфейс, чтобы
 * application-тикеты этого эпика могли компилироваться независимо, DTJ-270 п.6).
 */

/** DI-токен для провайдера `ReturnsOrdersPort`. */
export const RETURNS_ORDERS_PORT = Symbol.for('@dorutj/returns/orders-facade')

/** Непрозрачный дескриптор активной транзакции (тот же паттерн, что `PaymentsUnitOfWorkTx`). */
export type ReturnsUnitOfWorkTx = unknown

/**
 * Минимальный снэпшот заказа, нужный `returns` (SRS-RET-001/002 — ветвление «до/после
 * вручения» по `status`/`deliveredAt`). Не полная проекция агрегата `Order`.
 */
export interface OrderReturnContext {
  readonly orderId: string
  readonly status: string
  readonly pharmacyId: string | null
  readonly paymentMethod: string
  readonly deliveredAt: Date | null
}

export interface ReturnsOrdersPort {
  /** Чужой тенант ⇒ `null` (SRS-API-046: существование чужой строки не подтверждается). */
  getOrderForReturn(tenantId: string, orderId: string, tx?: ReturnsUnitOfWorkTx): Promise<OrderReturnContext | null>
}
