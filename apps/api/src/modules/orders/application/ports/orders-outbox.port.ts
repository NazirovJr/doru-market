/**
 * `OrdersOutboxPort` (EP-09, DTJ-227, SRS-DOM-151/152) — публикация доменных событий `Order`
 * (`OrderDomainEvent`, `domain/order-domain-event.ts`) в ТОЙ ЖЕ единице работы, что изменение
 * агрегата, — тот же паттерн, что `modules/inventory/application/ports/inventory-outbox.port.ts`
 * (DTJ-147), НЕ переизобретён заново (правило 12 AGENTS.md), пишет в ОБЩУЮ таблицу `outbox`
 * (EP-01, DTJ-016, `db/schema/outbox.schema.ts`), которую читает общий `OutboxRelayWorker`.
 *
 * ОТЛИЧИЕ от `InventoryOutboxPort`: там `append()` — синхронный fire-and-forget (см. JSDoc
 * `DrizzleInventoryOutboxAdapter`, осознанное решение блока C EP-05). Здесь — СТРОГО
 * противоположное решение по прямому требованию CTO: `appendAll` ОБЯЗАН быть `await`-нут
 * ВНУТРИ транзакции группы checkout (`OrdersUnitOfWorkPort.run`, тот же `tx`, что
 * `OrderRepositoryPort.save`) — SRS-DOM-151: «событие добавляется в тот же unitOfWork, что и
 * изменение состояния агрегата (запись в outbox в одной транзакции с записью в целевую
 * таблицу)». Fire-and-forget здесь означал бы: заказ закоммичен, событие потеряно при сбое
 * между `save()` и записью outbox — недопустимо для `OrderConfirmedEvent`/`OrderCancelledEvent`
 * (SRS-DOM-180, эскроу/аудит зависят от факта публикации).
 *
 * Потребители читают `outbox` at-least-once и обязаны быть идемпотентны по `event_id`
 * (SRS-DOM-152) — это не гарантия ЭТОГО порта, а контракт `OutboxRelayWorker`/подписчиков.
 */
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'
import type { OrderUnitOfWorkTx } from './order-repository.port.js'

export const ORDERS_OUTBOX = Symbol.for('@dorutj/orders/orders-outbox')

export interface OrdersOutboxPort {
  /**
   * Пишет ВСЕ переданные события ОДНИМ batch-insert на переданном `tx` (СВОЯ транзакция группы
   * checkout, D-EP09-21) — не отдельное соединение пула. Пустой массив — no-op (без запроса).
   */
  appendAll(tenantId: string, events: readonly OrderDomainEvent[], tx: OrderUnitOfWorkTx): Promise<void>
}
