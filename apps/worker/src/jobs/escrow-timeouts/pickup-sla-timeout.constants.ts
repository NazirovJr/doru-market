/**
 * Константы и DI-токены джобы `pickup-sla-timeout` (DTJ-254, SRS-DOM-092/179, SRS-ORD-035/036).
 * Зеркало `unpaid-order-timeout.constants.ts` (DTJ-253) по структуре имён — та же семья
 * timeout-джоб, тот же владелец-паттерн (см. её JSDoc).
 */
export const PICKUP_SLA_TIMEOUT_QUEUE = 'pickup-sla-timeout'
export const PICKUP_SLA_TIMEOUT_JOB_NAME = 'pickup-sla-timeout-tick'
export const PICKUP_SLA_TIMEOUT_SCHEDULER_ID = 'pickup-sla-timeout-periodic'
// Таймзона тика — тот же приём/обоснование, что `UNPAID_ORDER_TIMEOUT_TZ` (line-комментарий,
// не JSDoc — литерал cron-выражения содержит `*/`, ломающий `/** */`).
export const PICKUP_SLA_TIMEOUT_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const PICKUP_SLA_TIMEOUT_QUEUE_TOKEN = Symbol('PICKUP_SLA_TIMEOUT_QUEUE_TOKEN')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба выполняет ТОЛЬКО `SELECT`. */
export const PICKUP_SLA_TIMEOUT_DB_POOL = Symbol('PICKUP_SLA_TIMEOUT_DB_POOL')

/** DI-токен cron-выражения тика (ENV `PICKUP_SLA_TIMEOUT_CRON`, DoD тикета). */
export const PICKUP_SLA_TIMEOUT_CRON = Symbol('PICKUP_SLA_TIMEOUT_CRON')
