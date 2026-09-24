/**
 * Константы и DI-токены джоб `notifications` apps/worker (DTJ-370). Тот же приём, что
 * `cash-commission-aggregation.constants.ts` (DTJ-251): собственный `pg.Pool`, отдельный от
 * бизнес-пулов apps/api (apps/worker не может импортировать Drizzle-инстанс apps/api — отдельные
 * TS-проекты монорепо).
 */

/** Идемпотентность `OutboxToNotificationsConsumer` (SRS-DOM-152) — `consumer_name` для `processed_events`. */
export const NOTIFICATIONS_DISPATCH_CONSUMER = 'notifications.dispatch'

/** DI-токен `pg.Pool`, общий для `OutboxToNotificationsConsumer` и `NotificationDispatchProcessor`. */
export const NOTIFICATIONS_DB_POOL = Symbol('NOTIFICATIONS_DB_POOL')

/** DI-токен `NotificationDispatchStorePort`. */
export const NOTIFICATION_DISPATCH_STORE = Symbol('NOTIFICATION_DISPATCH_STORE')

/**
 * DI-токен BullMQ `Queue<NotificationDispatchJobData>` — apps/worker ОБА: consumer (обрабатывает
 * job'ы, `NotificationDispatchWorkerRunner`, DTJ-368) И producer (ставит job следующего канала при
 * каскаде фолбэка / первого внешнего канала из `OutboxToNotificationsConsumer`, DTJ-370).
 */
export const NOTIFICATION_DISPATCH_QUEUE = Symbol('NOTIFICATION_DISPATCH_QUEUE')
