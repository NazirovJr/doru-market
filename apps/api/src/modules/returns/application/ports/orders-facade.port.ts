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
 * Реализация — `DrizzleReturnsOrdersFacadeAdapter` (`infrastructure/adapters/`, DTJ-273): прямое
 * чтение `orders`/`order_items`/`pharmacies` (таблицы, не `modules/orders/**` — тот же приём, что
 * `DrizzleSupportOrdersFacadeAdapter`/`InventoryFacadeAdapter` в orders).
 *
 * РАСШИРЕНИЕ (DTJ-273/274/275, файл СВЕРХ буквального `files_owned` этих тикетов — правило 11
 * AGENTS.md, тот же приём, что DTJ-240): `OrderReturnContext` дополнен полями, которых не было в
 * скаффолдинге DTJ-270 (интерфейс объявлялся заведомо неполным — «не полная проекция», см. JSDoc
 * ниже) — `chainId`/`customerId` нужны `ReturnsPolicy` (владение «своя сеть»/«свой заказ»,
 * DTJ-273 п.6, DTJ-275 `GET /:id`), `billingStrategy` — `RefundOnReturnResolvedUseCase` (DTJ-274,
 * SRS-RET-009), `items` — `ConfirmReturnReceivedUseCase`/`ReturnsInventoryPort.restock` (DTJ-273
 * п.4, нужны позиции заказа для физического восстановления остатка).
 */

/** DI-токен для провайдера `ReturnsOrdersPort`. */
export const RETURNS_ORDERS_PORT = Symbol.for('@dorutj/returns/orders-facade')

/** Непрозрачный дескриптор активной транзакции (тот же паттерн, что `PaymentsUnitOfWorkTx`). */
export type ReturnsUnitOfWorkTx = unknown

/**
 * Позиция заказа, нужная для `ReturnsInventoryPort.restock` (DTJ-273 п.4) и для
 * `ReturnRestockEligibility` (`domain/order-return.entity.ts`, SRS-DOM-053/054): `expiresAt`/
 * `controlCategory` — примитивы (не VO чужого модуля `catalog`), по аналогии с
 * `ReturnsInventoryDisposition` в `inventory-facade.port.ts` этого же каталога.
 */
export interface ReturnOrderItemSnapshot {
  readonly medicineId: string
  readonly inventoryBatchId: string | null
  readonly quantity: number
  /** `null` — партия не резолвлена (`inventoryBatchId === null`), см. `pharmacy_inventory` FK. */
  readonly expiresAt: Date | null
  /** 1:1 с enum `control_category` (`db/schema/control-category.ts`). */
  readonly controlCategory: string
}

/**
 * Снэпшот заказа, нужный `returns` (SRS-RET-001/002 — ветвление «до/после вручения» по
 * `status`/`deliveredAt»). Не полная проекция агрегата `Order` — только поля, реально
 * потребляемые этим модулем (расширяется по мере надобности, см. JSDoc файла).
 */
export interface OrderReturnContext {
  readonly orderId: string
  readonly status: string
  readonly pharmacyId: string | null
  /** DTJ-273 п.6 — `ReturnsPolicy.canOverride`, «pharmacy_admin своей сети» (SRS-RET-011). */
  readonly chainId: string | null
  /** DTJ-275 `GET /:id` — `ReturnsPolicy.canRead`, «владелец заказа». */
  readonly customerId: string
  readonly paymentMethod: string
  /** DTJ-274 п.3, SRS-RET-009 — снэпшот на момент checkout, читается как есть. */
  readonly billingStrategy: 'single_invoice' | 'split_items_delivery'
  readonly deliveredAt: Date | null
  /** DTJ-273 п.2 (курьерская ветка, `picked_up`) — курьер, УЖЕ везущий заказ (`orders.courier_id`), не результат нового назначения. */
  readonly courierId: string | null
  readonly items: readonly ReturnOrderItemSnapshot[]
  /** DTJ-274 пп.4-6 — сумма позиций заказа (диримы), нужна `refundItems`/`refundFull`. `orders.items_total_tjs` конвертируется в infra-мапперe (правило 6 AGENTS.md). */
  readonly itemsTotalDiram: bigint
  /** DTJ-274 пп.4-6 — стоимость доставки (диримы), нужна `refundDelivery`/`recordAdjustment` (недополученная аптекой часть при `single_invoice`). */
  readonly deliveryFeeDiram: bigint
  /** DTJ-274 п.5-6 — `itemsTotalDiram + deliveryFeeDiram` (см. `chk_orders_total_amount` в схеме) — читается отдельным полем, не пересчитывается вызывающим кодом. */
  readonly totalAmountDiram: bigint
}

export interface ReturnsOrdersPort {
  /** Чужой тенант ⇒ `null` (SRS-API-046: существование чужой строки не подтверждается). */
  getOrderForReturn(tenantId: string, orderId: string, tx?: ReturnsUnitOfWorkTx): Promise<OrderReturnContext | null>

  /**
   * DTJ-275 — RBAC-владение courier-ветки `POST /api/v1/order-returns` (SRS-RET-011,
   * `ReturnsPolicy.canRequest`): `orders.courier_id` хранит `couriers.id`, JWT `sub` — `users.id`
   * (см. `couriers.user_id` FK, `db/schema/couriers.ts`) — резолвинг нужен ИМЕННО здесь, не в
   * `auth`, т.к. только `returns` знает, для чего сравнение требуется. `null` — пользователь не
   * зарегистрирован как курьер (роль `courier` без профиля — не должно происходить, но не
   * инвариант уровня БД, presentation обязан трактовать как «не назначен»).
   */
  getCourierIdForUser(tenantId: string, userId: string, tx?: ReturnsUnitOfWorkTx): Promise<string | null>
}
