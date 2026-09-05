/**
 * Константы и DI-токены джобы `payout-execution` (DTJ-250, SRS-PAY-033/034). Тот же владелец-
 * паттерн, что `escrow-reconciliation.constants.ts` (DTJ-247)/`unpaid-order-timeout.constants.ts`
 * (DTJ-253) по структуре имён.
 */
export const PAYOUT_EXECUTION_QUEUE = 'payout-execution'
export const PAYOUT_EXECUTION_JOB_NAME = 'payout-execution-tick'
export const PAYOUT_EXECUTION_SCHEDULER_ID = 'payout-execution-periodic'
// Line-комментарий, не JSDoc (литерал cron-выражения содержит `*/`, ломающий `/** */` —
// WAVE35-CORRECTION, тот же баг класс, что в соседних константных файлах этой семьи).
export const PAYOUT_EXECUTION_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const PAYOUT_EXECUTION_QUEUE_TOKEN = Symbol('PAYOUT_EXECUTION_QUEUE_TOKEN')

/** DI-токен `pg.Pool` — В ОТЛИЧИЕ от `escrow-timeouts/*`, эта джоба и СКАНИРУЕТ, и МУТИРУЕТ
 * `payout_schedule` напрямую (см. JSDoc `payout-execution.job.ts` — `payout_schedule` не несёт
 * доменного агрегата/state machine, тот же прецедент, что `PayoutSchedulerJob`, DTJ-249). */
export const PAYOUT_EXECUTION_DB_POOL = Symbol('PAYOUT_EXECUTION_DB_POOL')

/** DI-токен cron-выражения тика (ENV `PAYOUT_EXECUTION_CRON`). */
export const PAYOUT_EXECUTION_CRON = Symbol('PAYOUT_EXECUTION_CRON')

/** DI-токен размера батча за один тик (ENV `PAYOUT_BATCH_SIZE`, DoD тикета). */
export const PAYOUT_BATCH_SIZE = Symbol('PAYOUT_BATCH_SIZE')
