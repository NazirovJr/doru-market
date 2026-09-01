/**
 * Drizzle-схема `categories` (DTJ-091, EP-04). 1:1 DDL из `11-database-schema.md`
 * строки 321-334. Дерево навигации, отдельная плоская `commissionCategory` для
 * резолвинга `platform_fee` (D-03, SRS-CAT-003).
 *
 * ВАЖНО: enum `control_category` создаётся в `0006_catalog_core.sql` (эта же миграция
 * модуля), а в схеме используется `pgEnum` чтобы Drizzle генерировал согласованные
 * миграции. `commission_category` хранится как `varchar(20)` + CHECK (как в DDL).
 */
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, serial, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export const CATEGORIES_TABLE = 'categories'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новую
// сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const categories = pgTable(
  CATEGORIES_TABLE,
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id'),
    slug: varchar('slug', { length: 100 }).notNull(),
    nameTj: varchar('name_tj', { length: 255 }).notNull(),
    nameRu: varchar('name_ru', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }).notNull(),
    commissionCategory: varchar('commission_category', { length: 20 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
  },
  (table) => ({
    slugUniq: uniqueIndex('ux_categories_slug').on(table.slug),
    commissionCategoryCheck: check(
      'chk_categories_commission_category',
      sql`${table.commissionCategory} IN ('rx','otc','parapharma')`,
    ),
  }),
)

export type CategoryRow = typeof categories.$inferSelect
export type CategoryInsert = typeof categories.$inferInsert
