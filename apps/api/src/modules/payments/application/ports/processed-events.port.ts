/**
 * Порт `ProcessedEventsPort` (EP-10, DTJ-244, SRS-DOM-152) — идемпотентность потребителя
 * доменного события `OrderDeliveredEvent` (`CaptureEscrowUseCase`) поверх ОБЩЕЙ таблицы
 * `processed_events` (EP-01, DTJ-016, `db/schema/processed-events.schema.ts`) — уже существует
 * в базовой схеме, этот тикет ТОЛЬКО заводит порт для НОВОГО потребителя
 * (`consumer_name='payments.on-delivered'`).
 *
 * Составной PK `(consumer_name, event_id)` — конфликт вставки И ЕСТЬ механизм детекции «уже
 * обработано» (см. JSDoc самой таблицы) — at-least-once delivery (SRS-DOM-152), НЕ exactly-once.
 */
export const PROCESSED_EVENTS_PORT = Symbol.for('@dorutj/payments/processed-events-port')

export type PaymentsUnitOfWorkTxOpaque = unknown

export interface ProcessedEventsPort {
  /** `true` — событие обработано ВПЕРВЫЕ этим вызовом (продолжить бизнес-логику); `false` — уже было (SKIP). */
  markProcessed(consumerName: string, eventId: string, tx?: PaymentsUnitOfWorkTxOpaque): Promise<boolean>
}
