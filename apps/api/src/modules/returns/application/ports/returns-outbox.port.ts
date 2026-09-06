/**
 * Порт `ReturnsOutboxPort` (EP-11, DTJ-273). Файл СВЕРХ буквального `files_owned` (та же причина,
 * что `returns-unit-of-work.port.ts` этого же каталога). Пишет в ОБЩУЮ таблицу `outbox` (EP-01,
 * DTJ-016), 1:1 паттерн `support/application/ports/support-outbox.port.ts` (DTJ-279).
 *
 * `append` ОБЯЗАН быть `await`-нут ВНУТРИ той же транзакции, что `ReturnsRepositoryPort.save()` —
 * DoD DTJ-273 «outbox-события публикуются в ТОЙ ЖЕ транзакции, что изменение order_returns».
 */
import type { ReturnRequestedEvent } from '../../domain/events/return-requested.event.js'
import type { ReturnInTransitEvent } from '../../domain/events/return-in-transit.event.js'
import type { ReturnConfirmedEvent } from '../../domain/events/return-confirmed.event.js'
import type { ReturnRejectedEvent } from '../../domain/events/return-rejected.event.js'
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

export const RETURNS_OUTBOX = Symbol.for('@dorutj/returns/outbox')

export type ReturnsDomainEvent = ReturnRequestedEvent | ReturnInTransitEvent | ReturnConfirmedEvent | ReturnRejectedEvent

export interface ReturnsOutboxPort {
  append(tenantId: string, event: ReturnsDomainEvent, tx: ReturnsUnitOfWorkTx): Promise<void>
}
