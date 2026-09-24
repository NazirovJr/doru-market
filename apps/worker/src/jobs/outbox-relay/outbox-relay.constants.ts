/**
 * Константы и DI-токены джобы outbox-relay (DTJ-002, шаг 5). `OUTBOX_POLL_INTERVAL_MS` —
 * ASSUMPTION (тикет не фиксирует точное значение, только требует именованную константу, C6) —
 * пересматривается по факту нагрузочного тестирования DTJ-016.
 */

/** Период тика релея outbox → domain-events. ASSUMPTION: 2 секунды. */
export const OUTBOX_POLL_INTERVAL_MS = 2000

/** Размер порции `OutboxReaderPort.claimPending()` за один тик. ASSUMPTION. */
export const OUTBOX_RELAY_BATCH_LIMIT = 100

/** Внутренняя служебная очередь BullMQ, тикающая релей — НЕ очередь доменных событий. */
export const OUTBOX_RELAY_QUEUE_NAME = 'outbox-relay'

/** Имя повторяющейся джобы (BullMQ `upsertJobScheduler`). */
export const OUTBOX_RELAY_JOB_NAME = 'relay-tick'

/** Идентификатор шедулера — идемпотентная точка входа `upsertJobScheduler`. */
export const OUTBOX_RELAY_SCHEDULER_ID = 'outbox-relay-tick'

/** DI-токен BullMQ `Queue` служебной очереди тика (не путать с очередью domain-events). */
export const OUTBOX_RELAY_QUEUE = Symbol('OUTBOX_RELAY_QUEUE')

/** DI-токен BullMQ `Queue`, в которую релей публикует доменные события. */
export const DOMAIN_EVENTS_QUEUE = Symbol('DOMAIN_EVENTS_QUEUE')

/** DI-токен `pg.Pool` для чтения/мутации `outbox` напрямую. */
export const OUTBOX_RELAY_DB_POOL = Symbol('OUTBOX_RELAY_DB_POOL')
