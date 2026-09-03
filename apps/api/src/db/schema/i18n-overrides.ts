/**
 * Drizzle-схема `i18n_overrides` (DTJ-103, EP-07). Таблица заведена миграцией
 * `0024_i18n_overrides_review_status.sql` (владелец не определён ни одним ранее
 * реализованным тикетом на момент DTJ-103 — см. её JSDoc). DDL — 1:1 по
 * `docs/spec/11-database-schema.md` §45, `review_status` — расширение этого тикета
 * (SRS-CAT-041).
 *
 * Композитный PK `(tenant_id, locale, translation_key)` — точечное переопределение
 * строки для конкретного тенанта/локали/ключа, без отдельного суррогатного `id`.
 */
import { sql } from 'drizzle-orm'
import { pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const I18N_OVERRIDES_TABLE = 'i18n_overrides'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новую
// сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новую сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const i18nOverrides = pgTable(
  I18N_OVERRIDES_TABLE,
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 5 }).notNull(),
    translationKey: varchar('translation_key', { length: 255 }).notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
    // 'pending_legal_review' | 'approved' (DTJ-103, SRS-CAT-041). Управляет ТОЛЬКО
    // visual-индикатором в apps/admin, не показом пользователю.
    reviewStatus: varchar('review_status', { length: 20 }).notNull().default('pending_legal_review'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.locale, table.translationKey] }),
  }),
)

export type I18nOverrideRow = typeof i18nOverrides.$inferSelect
export type I18nOverrideInsert = typeof i18nOverrides.$inferInsert
