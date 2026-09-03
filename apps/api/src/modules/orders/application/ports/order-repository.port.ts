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
 */
import type { Order } from '@/modules/orders/domain/order.entity.js'

export const ORDER_REPOSITORY_PORT = Symbol.for('@dorutj/orders/order-repository')

/** Опаковый дескриптор активной транзакции — `unknown` (см. JSDoc файла). */
export type OrderUnitOfWorkTx = unknown

export interface OrderRepositoryPort {
  findById(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null>
  findByCheckoutAttemptId(tenantId: string, checkoutAttemptId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null>
  /** Upsert по `id` (правило 6 волны 5 — `saveMany`/`save` обязаны быть upsert, не голый `UPDATE`). */
  save(order: Order, tx?: OrderUnitOfWorkTx): Promise<void>
}
