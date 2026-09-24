/**
 * `DeliveryOrdersPort` (EP-13, DTJ-321). Файл СВЕРХ буквального `files_owned` (тот же приём, что
 * `courier-rating.repository.port.ts`/`courier-earnings.repository.port.ts` этого же тикета) —
 * `SubmitCourierRatingUseCase` не может проверить «только владелец заказа»/«только
 * `order.status='delivered'`» (SRS-DELIV-032, текст тикета п.3) без доступа к заказу.
 *
 * Межмодульный фасад `delivery → orders` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) — 1:1 паттерн
 * `modules/returns/application/ports/orders-facade.port.ts` (DTJ-270)/`modules/payments/
 * application/ports/orders-facade.port.ts` (DTJ-236): сигнатура использует ТОЛЬКО примитивы/
 * локальные типы `delivery`, никогда доменные VO `orders`. Реализация —
 * `infrastructure/adapters/delivery-orders.adapter.ts`, тонкая обёртка поверх реального
 * `modules/orders` → `OrdersFacade` (публичный фасад, `02` §1.2).
 *
 * `tenantId` — первый обязательный параметр (тот же приём, что `PaymentsOrdersPort`/
 * `ReturnsOrdersPort`): чужой тенант обязан вести себя как «заказа не существует» (`null`), не
 * «доступ запрещён» (SRS-API-043/046) — `OrdersFacade.getOrderById(tenantId, orderId)` уже
 * реализует это поведение, адаптер лишь делегирует.
 */

/** DI-токен для провайдера `DeliveryOrdersPort`. */
export const DELIVERY_ORDERS_PORT = Symbol.for('@dorutj/delivery/orders-facade')

/**
 * Минимальный снэпшот заказа, нужный `SubmitCourierRatingUseCase` (владелец/статус) — не полная
 * проекция агрегата `Order`.
 */
export interface OrderRatingContext {
  readonly orderId: string
  readonly customerId: string
  readonly status: string
}

export interface DeliveryOrdersPort {
  /** Чужой тенант ⇒ `null` (SRS-API-046: существование чужой строки не подтверждается). */
  getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null>
}
