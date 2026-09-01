/**
 * Реализация `SearchQueryLogRetentionPort` поверх `pg.Pool` (DTJ-181). Один параметризованный
 * `DELETE` — не требует Drizzle: `apps/worker` не подключает чужой Drizzle-граф `apps/api`
 * (см. JSDoc порта). `result.rowCount` — точное число удалённых строк (используется тестом
 * AC3 тикета: записи старше `cutoff` удалены, младше — нет).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { PRUNE_SEARCH_QUERY_LOG_DB_POOL } from './prune-search-query-log.constants.js'
import type { SearchQueryLogRetentionPort } from './search-query-log-retention.port.js'

const DELETE_OLDER_THAN_SQL = 'DELETE FROM search_query_log WHERE created_at < $1'

@Injectable()
export class PgSearchQueryLogRetentionAdapter implements SearchQueryLogRetentionPort {
  constructor(@Inject(PRUNE_SEARCH_QUERY_LOG_DB_POOL) private readonly pool: Pool) {}

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.pool.query(DELETE_OLDER_THAN_SQL, [cutoff])
    return result.rowCount ?? 0
  }
}
