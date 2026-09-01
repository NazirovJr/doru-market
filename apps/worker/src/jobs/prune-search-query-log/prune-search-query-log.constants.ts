/**
 * Константы и DI-токены джобы `prune-search-query-log` (DTJ-181, `SRS-CAT-070`).
 * Таймзона — Asia/Dushanbe (`01-TECH-BASELINE.md`); расписание — ежедневно 04:30, после
 * ночной 1С-синхронизации (03:00, D-04) и джобы `license-expiry-check` (06:00 — та идёт
 * ПОЗЖЕ, порядок не критичен, обе независимы), в окне низкой нагрузки.
 */
export const PRUNE_SEARCH_QUERY_LOG_QUEUE = 'prune-search-query-log'
export const PRUNE_SEARCH_QUERY_LOG_JOB_NAME = 'prune-search-query-log-tick'
export const PRUNE_SEARCH_QUERY_LOG_SCHEDULER_ID = 'prune-search-query-log-daily'
export const PRUNE_SEARCH_QUERY_LOG_CRON = '30 4 * * *'
export const PRUNE_SEARCH_QUERY_LOG_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN = Symbol('PRUNE_SEARCH_QUERY_LOG_QUEUE')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — эта джоба ничего, кроме
 *  параметризованного `DELETE FROM search_query_log`, не выполняет. */
export const PRUNE_SEARCH_QUERY_LOG_DB_POOL = Symbol('PRUNE_SEARCH_QUERY_LOG_DB_POOL')

/** DI-токен горизонта хранения в днях (ENV `SEARCH_QUERY_LOG_RETENTION_DAYS`, SRS-CAT-070). */
export const SEARCH_QUERY_LOG_RETENTION_DAYS = Symbol('SEARCH_QUERY_LOG_RETENTION_DAYS')
