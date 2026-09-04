/**
 * Константы и DI-токены джобы `cash-commission-aggregation` (DTJ-251, SRS-PAY-036). ДВА
 * независимых BullMQ-расписания на ОДНОЙ очереди (см. JSDoc `cash-commission-aggregation.
 * scheduler.ts`): ежедневная агрегация и еженедельный переход `draft → issued` — буквальный
 * текст тикета «Что сделать» п.3 явно разрешает «тот же файл джобы, второй cron».
 *
 * Таймзона — Asia/Dushanbe (`01-TECH-BASELINE.md`), тот же приём, что сёстры-джобы
 * (`ESCROW_RECONCILIATION_TZ`/`UNPAID_ORDER_TIMEOUT_TZ`/`PAYOUT_SCHEDULER_TZ`) — здесь ЕЩЁ и
 * содержательно значима (не только для BullMQ-расписания): вся арифметика периода
 * (`cash-commission-aggregation.util.ts`) считается в ЭТОЙ таймзоне.
 */
export const CASH_COMMISSION_AGGREGATION_QUEUE = 'cash-commission-aggregation'
export const CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME = 'cash-commission-aggregation-daily-tick'
export const CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME = 'cash-commission-aggregation-weekly-issue-tick'
export const CASH_COMMISSION_AGGREGATION_DAILY_SCHEDULER_ID = 'cash-commission-aggregation-daily'
export const CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_SCHEDULER_ID = 'cash-commission-aggregation-weekly-issue'
export const CASH_COMMISSION_AGGREGATION_TZ = 'Asia/Dushanbe'

/** Идемпотентность (AC2 тикета) — `consumer_name` для `processed_events` (таблица EP-01, DTJ-016, переиспользуется, см. JSDoc джобы). */
export const CASH_COMMISSION_AGGREGATION_CONSUMER = 'cash-commission-aggregation'

/** DI-токен BullMQ `Queue` служебной очереди обоих тиков. */
export const CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN = Symbol('CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api. */
export const CASH_COMMISSION_AGGREGATION_DB_POOL = Symbol('CASH_COMMISSION_AGGREGATION_DB_POOL')

/** DI-токен cron-выражения ежедневного тика (ENV `CASH_COMMISSION_AGGREGATION_DAILY_CRON`, DoD тикета). */
export const CASH_COMMISSION_AGGREGATION_DAILY_CRON = Symbol('CASH_COMMISSION_AGGREGATION_DAILY_CRON')

/** DI-токен cron-выражения еженедельного тика (ENV `CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON`, DoD тикета). */
export const CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON = Symbol('CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON')
