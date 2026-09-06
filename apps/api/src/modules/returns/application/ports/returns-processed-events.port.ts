/**
 * Порт `ReturnsProcessedEventsPort` (EP-11, DTJ-274, SRS-DOM-152). Идемпотентность потребителя
 * `ReturnConfirmedEvent`/`ReturnRejectedEvent` (`RefundOnReturnResolvedUseCase`) поверх ОБЩЕЙ
 * таблицы `processed_events` (EP-01, DTJ-016, `db/schema/processed-events.schema.ts`) — 1:1
 * приём `modules/payments/application/ports/processed-events.port.ts` (DTJ-244): составной PK
 * `(consumer_name, event_id)`, конфликт вставки И ЕСТЬ детекция «уже обработано» (at-least-once,
 * НЕ exactly-once).
 */
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

export const RETURNS_PROCESSED_EVENTS_PORT = Symbol.for('@dorutj/returns/processed-events')

export interface ReturnsProcessedEventsPort {
  /** `true` — событие обработано ВПЕРВЫЕ этим вызовом; `false` — уже было (SKIP). */
  markProcessed(consumerName: string, eventId: string, tx?: ReturnsUnitOfWorkTx): Promise<boolean>
}
