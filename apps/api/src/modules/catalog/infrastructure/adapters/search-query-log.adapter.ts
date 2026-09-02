/**
 * Drizzle-реализация `SearchQueryLogRepository` (EP-06, DTJ-188, `SRS-CAT-069`).
 *
 * Простой insert-адаптер поверх `search_query_log` (схема — DTJ-181, `@/db/schema/
 * search-query-log.schema.js`, уже существует и зарегистрирована в барреле `db/schema/index.ts`).
 * Тот же приём, что `AnalogCandidatesAdapter`/`DrizzleUsersRepository`: общий `DRIZZLE_DB`
 * (DTJ-051), конструктор не открывает соединение (ленивый пул).
 *
 * @see apps/api/src/db/schema/search-query-log.schema.ts
 * @see tickets/ep05-search-map/DTJ-188.md
 */
import { Inject, Injectable } from '@nestjs/common'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { searchQueryLog } from '@/db/schema/search-query-log.schema.js'
import {
  SEARCH_QUERY_LOG_REPOSITORY,
  type SearchQueryLogEntry,
  type SearchQueryLogRepository,
} from '@/modules/catalog/application/ports/search-query-log.port.js'

/** `search_query_log.query_text` — `VARCHAR(255)` (DTJ-181 DDL). */
const QUERY_TEXT_MAX_LENGTH = 255

@Injectable()
export class SearchQueryLogAdapter implements SearchQueryLogRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async insert(entry: SearchQueryLogEntry): Promise<void> {
    await this.db.insert(searchQueryLog).values({
      tenantId: entry.tenantId,
      customerId: entry.customerId,
      // Защитный клампинг под ограничение схемы (ASSUMPTION — не покрыто AC DTJ-188/181):
      // без него запрос с текстом длиннее 255 символов упал бы `value too long for type
      // character varying(255)` вместо честной записи усечённого варианта в лог.
      queryText: entry.queryText.slice(0, QUERY_TEXT_MAX_LENGTH),
      resultsCount: entry.resultsCount,
    })
  }
}

/** DI-привязка для `SEARCH_QUERY_LOG_REPOSITORY` (D-27), тот же приём, что `ANALOG_CANDIDATES_REPOSITORY_PROVIDER`. */
export const SEARCH_QUERY_LOG_REPOSITORY_PROVIDER = {
  provide: SEARCH_QUERY_LOG_REPOSITORY,
  useClass: SearchQueryLogAdapter,
} as const
