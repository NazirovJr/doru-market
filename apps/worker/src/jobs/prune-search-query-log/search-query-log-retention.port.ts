/**
 * Порт очистки `search_query_log` по retention (DTJ-181, `SRS-CAT-070`,
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3: interface + DI-токен рядом). Таблица
 * определена в схеме `apps/api` (`db/schema/search-query-log.schema.ts`) — `apps/worker`
 * не подключает чужой Drizzle-граф ради одного `DELETE`, реализация порта
 * (`PgSearchQueryLogRetentionAdapter`) использует параметризованный raw SQL через `pg`.
 */
export const SEARCH_QUERY_LOG_RETENTION_PORT = Symbol('SEARCH_QUERY_LOG_RETENTION_PORT')

export interface SearchQueryLogRetentionPort {
  /** Удаляет строки `search_query_log` с `created_at < cutoff`. Возвращает число удалённых строк. */
  deleteOlderThan(cutoff: Date): Promise<number>
}
