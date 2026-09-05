/**
 * `OrderRepositoryPort` (EP-09, DTJ-222, тенант-скоуп — доработка DTJ-227 по замечанию CTO,
 * SRS-API-043/046) — персистентность `Order`, потребляется ТОЛЬКО `OrdersFacade` (`02` §3.3:
 * границы транзакции задаёт use case, репозиторий/фасад — не источник транзакции). Реализация
 * — `DrizzleOrderRepository` (`infrastructure/repositories/order.repository.ts`, DTJ-227).
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043, обязательное правило проекта, тот же образец, что
 * `CartRepository`/`DrizzleCartRepository`, D-EP09-10): `tenantId` — ПЕРВЫЙ явный параметр
 * `findById`/`findByCheckoutAttemptId`, НЕ опционален — вызов без него ошибка компиляции TS,
 * не забытый рантайм-фильтр. Чужой тенант ⇒ `null` (SRS-API-046: `404`, не `403`, чужой заказ
 * по `id` не подтверждается как существующий). Порт первой версии (DTJ-222) tenantId не нёс —
 * это исправлено ЗДЕСЬ, при подключении реальной Drizzle-реализации (DTJ-227), до этого
 * момента утечка была теоретической (не было ни одной реализации).
 *
 * `save()` БЕЗ отдельного `tenantId`-параметра — `Order` уже несёт `tenantId` полем (домен,
 * DTJ-221), а сам объект получен вызывающим кодом ТОЛЬКО через тенант-скоупленный
 * `findById`/`findByCheckoutAttemptId` либо только что создан `Order.create()` для СВОЕГО
 * `cmd.tenantId` — нет пути получить чужой `Order` для записи.
 *
 * `UnitOfWorkTx` — непрозрачный дескриптор транзакции (тот же паттерн, что
 * `modules/auth/application/ports/unit-of-work.port.ts`, DTJ-024) — application-порт не знает
 * конкретный тип БД-клиента, только «что-то, передаваемое дальше в Drizzle-реализацию».
 *
 * РАСШИРЕНИЕ (DTJ-301, EP-12, модуль 24 «Терминал фармацевта») — `findByIdForUpdate`/
 * `setAssignedPharmacist`/`findQueueOrders`/`findPharmacyIdsByChain`/`findAssignedPharmacistName`.
 * `orders.assigned_pharmacist_id` — намеренно НЕ поле домена `Order` (DTJ-300, `[РАСШИРЕНИЕ]`,
 * UX-блокировка «кто ведёт сборку», НЕ RBAC/бизнес-инвариант, SRS-PHT-038) — поэтому эти методы
 * работают с ним НАПРЯМУЮ, в обход `OrderSnapshot`, возвращая его РЯДОМ с доменным `Order`
 * (`LockedOrderRow`), а не переносят поле в агрегат ради одного тикета.
 */
import type { OrderPaymentMethod, OrderStatus } from '@dorutj/contracts'
import type { Order } from '@/modules/orders/domain/order.entity.js'

export const ORDER_REPOSITORY_PORT = Symbol.for('@dorutj/orders/order-repository')

/** Опаковый дескриптор активной транзакции — `unknown` (см. JSDoc файла). */
export type OrderUnitOfWorkTx = unknown

/** DTJ-301 — результат `findByIdForUpdate`: агрегат + значение колонки вне домена (см. JSDoc файла). */
export interface LockedOrderRow {
  readonly order: Order
  readonly assignedPharmacistId: string | null
}

/**
 * DTJ-301 (SRS-PHT-005/005a) — область видимости очереди: ОДНА аптека (`pharmacist`, либо
 * `pharmacy_admin` с явным `filter[pharmacyId]`) или ВСЯ сеть (`pharmacy_admin` без фильтра,
 * `chainId` резолвится в список `pharmacyId` инфраструктурой, `findPharmacyIdsByChain`).
 */
export type OrderQueueScope =
  | { readonly kind: 'pharmacy'; readonly pharmacyId: string }
  | { readonly kind: 'chain'; readonly chainId: string }

export interface OrderQueueQuery {
  readonly tenantId: string
  readonly scope: OrderQueueScope
  readonly statuses: readonly OrderStatus[]
}

/**
 * DTJ-301 (SRS-PHT-006) — проекция ОДНОЙ позиции очереди, БЕЗ сортировки (сортировка —
 * `OrderQueueSortPolicy`, application, «резолвится в application, НЕ поле БД»). Плоский DTO-подобный
 * тип, не `Order`/`OrderSnapshot` — очередь несёт поля (`itemsCount`, `assignedPharmacistName`),
 * которых у доменного агрегата НЕТ и не будет (агрегированный JOIN-проекция, не мутируемое состояние).
 */
export interface OrderQueueRow {
  readonly id: string
  readonly orderNumber: string
  readonly status: OrderStatus
  readonly pharmacyId: string
  readonly itemsCount: number
  readonly itemsTotalTjs: number
  readonly paymentMethod: OrderPaymentMethod
  readonly prescriptionRequired: boolean
  readonly slaDeadlineAt: Date | null
  readonly assignedPharmacistId: string | null
  readonly assignedPharmacistName: string | null
  readonly createdAt: Date
}

export interface OrderRepositoryPort {
  findById(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null>
  findByCheckoutAttemptId(tenantId: string, checkoutAttemptId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null>
  /** Upsert по `id` (правило 6 волны 5 — `saveMany`/`save` обязаны быть upsert, не голый `UPDATE`). */
  save(order: Order, tx?: OrderUnitOfWorkTx): Promise<void>

  /**
   * DTJ-301 (SRS-PHT-007/009) — `SELECT ... FOR UPDATE` на строку `orders`, сериализует
   * конкурентные `accept`/`reclaim` (TC-PHT-023). `tx` ОБЯЗАТЕЛЕН (не опционален, в отличие от
   * остальных методов порта) — блокировка вне активной транзакции снимается сразу после
   * `SELECT` и не даёт никакой гарантии, вызывающий код обязан быть внутри
   * `OrdersUnitOfWorkPort.run(...)`.
   */
  findByIdForUpdate(tenantId: string, orderId: string, tx: OrderUnitOfWorkTx): Promise<LockedOrderRow | null>

  /** DTJ-301 — точечный `UPDATE orders.assigned_pharmacist_id` (см. JSDoc файла — поле вне домена). */
  setAssignedPharmacist(orderId: string, pharmacistId: string, tx: OrderUnitOfWorkTx): Promise<void>

  /** DTJ-301 (SRS-PHT-009) — имя ТЕКУЩЕГО держателя заказа, только для `details.assignedPharmacistName`
   *  в `OrderAlreadyClaimedError` (best-effort: `null`, если пользователь не найден — не блокирует ответ). */
  findAssignedPharmacistName(pharmacistId: string): Promise<string | null>

  /** DTJ-301 (SRS-PHT-005/005a) — кандидаты очереди, БЕЗ сортировки/пагинации (см. `OrderQueueRow`). */
  findQueueOrders(query: OrderQueueQuery): Promise<readonly OrderQueueRow[]>

  /** DTJ-301 (SRS-PHT-005a) — все `pharmacyId` сети `chainId` (см. JSDoc реализации — `chain_id`
   *  не требует отдельного тенант-фильтра здесь, `findQueueOrders` уже скоупит по `tenantId`). */
  findPharmacyIdsByChain(tenantId: string, chainId: string): Promise<readonly string[]>
}
