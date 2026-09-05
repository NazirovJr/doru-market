/**
 * Константы и DI-токены джобы `unpaid-order-timeout` (DTJ-253, SRS-ORD-032..034). Зеркало
 * `escrow-reconciliation.constants.ts` (DTJ-247) по структуре имён.
 */
export const UNPAID_ORDER_TIMEOUT_QUEUE = 'unpaid-order-timeout'
export const UNPAID_ORDER_TIMEOUT_JOB_NAME = 'unpaid-order-timeout-tick'
export const UNPAID_ORDER_TIMEOUT_SCHEDULER_ID = 'unpaid-order-timeout-periodic'
// Таймзона тика — не влияет на семантику интервального cron-выражения (каждые N минут), но
// задаётся явно (не оставлена системной) — тот же приём, что `ESCROW_RECONCILIATION_TZ`.
// Line-комментарий, не JSDoc-блок — литерал cron-выражения содержит `*/`, ломающий `/** */`
// (тот же баг класс, что WAVE35-CORRECTION в `vitest.integration.config.ts`).
export const UNPAID_ORDER_TIMEOUT_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN = Symbol('UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба выполняет ТОЛЬКО `SELECT`. */
export const UNPAID_ORDER_TIMEOUT_DB_POOL = Symbol('UNPAID_ORDER_TIMEOUT_DB_POOL')

/** DI-токен cron-выражения тика (ENV `UNPAID_ORDER_TIMEOUT_CRON`, DoD тикета). */
export const UNPAID_ORDER_TIMEOUT_CRON = Symbol('UNPAID_ORDER_TIMEOUT_CRON')
