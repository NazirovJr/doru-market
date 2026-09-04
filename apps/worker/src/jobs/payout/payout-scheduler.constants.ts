/**
 * Константы и DI-токены джобы `payout-scheduler` (DTJ-249, SRS-DOM-103/D-19, SRS-PAY-030/032).
 * Зеркало `unpaid-order-timeout.constants.ts`/`escrow-reconciliation.constants.ts` по структуре
 * имён. Таймзона — Asia/Dushanbe (`01-TECH-BASELINE.md`), тот же приём, что сёстры-джобы;
 * расписание — ежечасно (ASSUMPTION, буквальный текст тикета «Технический контекст»).
 */
export const PAYOUT_SCHEDULER_QUEUE = 'payout-scheduler'
export const PAYOUT_SCHEDULER_JOB_NAME = 'payout-scheduler-tick'
export const PAYOUT_SCHEDULER_SCHEDULER_ID = 'payout-scheduler-hourly'
export const PAYOUT_SCHEDULER_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const PAYOUT_SCHEDULER_QUEUE_TOKEN = Symbol('PAYOUT_SCHEDULER_QUEUE_TOKEN')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба выполняет один батчевый `UPDATE`. */
export const PAYOUT_SCHEDULER_DB_POOL = Symbol('PAYOUT_SCHEDULER_DB_POOL')

/** DI-токен cron-выражения тика (ENV `PAYOUT_SCHEDULER_CRON`, DoD тикета). */
export const PAYOUT_SCHEDULER_CRON = Symbol('PAYOUT_SCHEDULER_CRON')
