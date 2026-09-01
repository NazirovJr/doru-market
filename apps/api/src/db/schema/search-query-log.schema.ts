/**
 * Drizzle-схема `search_query_log` (EP-06, DTJ-181, `SRS-CAT-069`,
 * `docs/spec/20-module-catalog-search.md` §14.3). Журнал поисковых запросов —
 * источник (а) trending searches при пустом вводе (§5, `SRS-CAT-030`), (б)
 * воронки продуктовой аналитики R1-15 (показ экономии → клик на аналог →
 * корзина → заказ, `analytics` джойнит эту таблицу с `order_items` по
 * `clicked_medicine_id`).
 *
 * Пишет `SearchMedicinesUseCase` (DTJ-188, тот же эпик) — каждый вызов
 * добавляет одну строку. `clicked_medicine_id` заполняется ОТДЕЛЬНЫМ событием
 * клика позже (nullable на момент записи запроса).
 *
 * Приватность (`SRS-CAT-070`): `query_text` подпадает под общую политику
 * хранения `audit_log`-подобных записей — retention 180 дней
 * (`SEARCH_QUERY_LOG_RETENTION_DAYS`, ASSUMPTION), очистка —
 * `apps/worker/src/jobs/prune-search-query-log` (BullMQ repeatable,
 * 04:30 `Asia/Dushanbe`), не хранится бессрочно.
 */
import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { medicines } from './medicines.js'
import { tenants } from './tenants.js'
import { users } from './users.js'

export const SEARCH_QUERY_LOG_TABLE = 'search_query_log'

export const searchQueryLog = pgTable(
  SEARCH_QUERY_LOG_TABLE,
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // NULL — гостевой поиск без авторизации.
    customerId: uuid('customer_id').references(() => users.id, { onDelete: 'set null' }),
    queryText: varchar('query_text', { length: 255 }).notNull(),
    resultsCount: integer('results_count').notNull(),
    // Заполняется отдельным событием клика, nullable на момент записи запроса.
    clickedMedicineId: uuid('clicked_medicine_id').references(() => medicines.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Trending searches (§5, SRS-CAT-030) + PruneSearchQueryLogJob (retention DELETE по created_at).
    index('ix_search_query_log_trending').on(table.tenantId, table.createdAt.desc()),
  ],
)

export type SearchQueryLogRow = typeof searchQueryLog.$inferSelect
export type SearchQueryLogInsert = typeof searchQueryLog.$inferInsert
