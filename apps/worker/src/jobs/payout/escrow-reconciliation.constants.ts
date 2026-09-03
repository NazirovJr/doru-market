/**
 * Константы и DI-токены джобы `escrow-reconciliation` (DTJ-247, SRS-PAY-013/014,
 * `21-module-orders-payments-escrow.md` §4.3). Таймзона — Asia/Dushanbe
 * (`01-TECH-BASELINE.md`); расписание — ежедневно 03:00, ПОСЛЕ ночной 1С-синхронизации, не
 * одновременно с ней (ticket «Технический контекст»).
 */
export const ESCROW_RECONCILIATION_QUEUE = 'escrow-reconciliation'
export const ESCROW_RECONCILIATION_JOB_NAME = 'escrow-reconciliation-tick'
export const ESCROW_RECONCILIATION_SCHEDULER_ID = 'escrow-reconciliation-daily'
export const ESCROW_RECONCILIATION_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const ESCROW_RECONCILIATION_QUEUE_TOKEN = Symbol('ESCROW_RECONCILIATION_QUEUE')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба выполняет `SELECT`/`INSERT`. */
export const ESCROW_RECONCILIATION_DB_POOL = Symbol('ESCROW_RECONCILIATION_DB_POOL')

/** DI-токен cron-выражения тика (ENV `RECONCILIATION_CRON`, DoD тикета). */
export const RECONCILIATION_CRON = Symbol('RECONCILIATION_CRON')

/** DI-токен горизонта дедупликации `support_ticket` в днях (ENV `RECONCILIATION_DEDUP_DAYS`, DoD тикета). */
export const RECONCILIATION_DEDUP_DAYS = Symbol('RECONCILIATION_DEDUP_DAYS')
