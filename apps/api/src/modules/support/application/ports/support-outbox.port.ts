/**
 * Порт `SupportOutboxPort` (EP-14, DTJ-279). Файл СВЕРХ буквального `files_owned` (см. JSDoc
 * `support-unit-of-work.port.ts` этого же каталога — та же причина). Пишет в ОБЩУЮ таблицу
 * `outbox` (EP-01, DTJ-016), 1:1 паттерн `payments/application/ports/payments-outbox.port.ts`
 * (DTJ-242).
 *
 * `append` ОБЯЗАН быть `await`-нут ВНУТРИ той же транзакции, что мутация агрегата, которую он
 * сопровождает (критерий приёмки 4 DTJ-279 для `SupportTicketCreatedEvent`, аналогично для
 * `SlaBreachedEvent`, DTJ-280) — иначе событие может потеряться при сбое между `COMMIT` и
 * записью в outbox.
 *
 * `event` — объединение (DTJ-280 расширяет DTJ-279's): каждый новый тип события этого модуля
 * добавляется в union АДДИТИВНО, не заменяя предыдущий (тот же приём, что расширение DTO в
 * `packages/contracts`).
 */
import type { SupportTicketCreatedEvent } from '../../domain/events/support-ticket-created.event.js'
import type { SlaBreachedEvent } from '../../domain/events/sla-breached.event.js'
import type { SupportUnitOfWorkTx } from './support-unit-of-work.port.js'

export const SUPPORT_OUTBOX = Symbol.for('@dorutj/support/outbox')

export type SupportOutboxEvent = SupportTicketCreatedEvent | SlaBreachedEvent

export interface SupportOutboxPort {
  append(tenantId: string, event: SupportOutboxEvent, tx: SupportUnitOfWorkTx): Promise<void>
}
