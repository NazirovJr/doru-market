/**
 * `DeliveryOutboxPort` (EP-13, DTJ-320). Файл СВЕРХ буквального `files_owned` (тот же приём, что
 * `support/application/ports/support-outbox.port.ts`, DTJ-279, см. её JSDoc) — DoD DTJ-320 «закрытие
 * смены не блокируется недоступностью audit_log-сервиса (событие публикуется через outbox, не
 * синхронным вызовом, который мог бы уронить сам `end`)» требует транзакционного outbox, не прямого
 * вызова какого-либо внешнего audit-сервиса из use case.
 *
 * Пишет в ОБЩУЮ таблицу `outbox` (EP-01, DTJ-016), 1:1 паттерн `drizzle-support-outbox.adapter.ts`.
 * `append` ОБЯЗАН быть вызван ВНУТРИ той же транзакции, что доменные мутации (`CourierShift.close()`/
 * `Courier.goOffShift()`), иначе событие может потеряться при сбое между `COMMIT` и записью в outbox.
 *
 * Материализация конкретно в `audit_log(category='cash_reconciliation_discrepancy')` — ниже по
 * течению (`OutboxRelayProcessor` → очередь `domain-events` → потребитель, владеющий `audit_log`,
 * EP-16 по тексту тикета DTJ-306) — ВНЕ периметра DTJ-320 (нет `files_owned` на `apps/worker/**`
 * в этом тикете); см. риски DTJ-320 и отчёт сдачи про эту границу.
 */
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_OUTBOX = Symbol.for('@dorutj/delivery/outbox')

export interface DeliveryOutboxPort {
  /** `tenantId` — `null`, если недоступен для агрегата-источника (напр. курьер платформенного пула,
   * `couriers.chain_id IS NULL` — таблица `outbox.tenant_id` нативно nullable, `db/schema/outbox.schema.ts`). */
  append(event: DeliveryDomainEvent, tenantId: string | null, tx: DeliveryUnitOfWorkTx): Promise<void>
}
