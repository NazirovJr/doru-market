export const PROCESSED_EVENTS_PORT = Symbol.for('@dorutj/common/processed-events-port')

export interface ProcessedEventsPort {
  /** `true` — событие обработано ВПЕРВЫЕ этим вызовом; `false` — уже было (at-least-once outbox). */
  markProcessed(consumerName: string, eventId: string, tx?: unknown): Promise<boolean>
}
