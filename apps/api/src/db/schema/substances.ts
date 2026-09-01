/**
 * Drizzle-схема `substances` (DTJ-091, EP-04). 1:1 DDL из `11-database-schema.md`
 * строки 340-348. Справочник действующих веществ (D-07). PK — UUID v4 с дефолтом
 * `gen_random_uuid()` (SRS-DB-001: прикладной код передаёт v7 явно через
 * `IdGenerator` порт, БД-дефолт — fallback для миграций/сидов).
 */
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export const SUBSTANCES_TABLE = 'substances'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новую
// сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const substances = pgTable(
  SUBSTANCES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    innName: varchar('inn_name', { length: 255 }).notNull(),
    innNameEn: varchar('inn_name_en', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    innNameUniq: uniqueIndex('ux_substances_inn_name').on(table.innName),
    innNameEnIdx: index('ix_substances_inn_name_en').on(table.innNameEn),
  }),
)

export type SubstanceRow = typeof substances.$inferSelect
export type SubstanceInsert = typeof substances.$inferInsert

/** Re-export, чтобы не дублировать описание DDL в комментариях. */
export const _substanceSchemaDescription = text(
  'substances_schema_description',
).generatedAlwaysAs(sql`'DoruTJ / substances (D-07, EP-04)'`)
