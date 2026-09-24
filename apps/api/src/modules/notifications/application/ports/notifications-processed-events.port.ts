/** Идемпотентность consumer'а поверх общей таблицы `processed_events` (узкий порт, как у payments/returns). */
export const NOTIFICATIONS_PROCESSED_EVENTS_PORT = Symbol.for('@dorutj/notifications/processed-events-port')
export const NOTIFICATIONS_DISPATCH_CONSUMER_NAME = 'notifications.dispatch'

export interface NotificationsProcessedEventsPort {
  /** `true` — обработано впервые; `false` — уже было (at-least-once outbox). */
  markProcessed(consumerName: string, eventId: string): Promise<boolean>
}
