/**
 * Порт `SupportOutboxPort` (EP-14, DTJ-279). Файл СВЕРХ буквального `files_owned` (см. JSDoc
 * `support-unit-of-work.port.ts` этого же каталога — та же причина). Пишет в ОБЩУЮ таблицу
 * `outbox` (EP-01, DTJ-016), 1:1 паттерн `payments/application/ports/payments-outbox.port.ts`
 * (DTJ-242).
 *
 * `append` ОБЯЗАН быть `await`-нут ВНУТРИ той же транзакции, что `SupportTicketsRepositoryPort.
 * save()` (критерий приёмки 4 DTJ-279) — иначе `SupportTicketCreatedEvent` может потеряться при
 * сбое между `COMMIT` и записью в outbox.
 */
import type { SupportTicketCreatedEvent } from '../../domain/events/support-ticket-created.event.js'
import type { SupportUnitOfWorkTx } from './support-unit-of-work.port.js'

export const SUPPORT_OUTBOX = Symbol.for('@dorutj/support/outbox')

export interface SupportOutboxPort {
  append(tenantId: string, event: SupportTicketCreatedEvent, tx: SupportUnitOfWorkTx): Promise<void>
}
