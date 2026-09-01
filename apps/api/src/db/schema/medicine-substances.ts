/**
 * Drizzle-схема `medicine_substances` (DTJ-091, EP-04). Мост `Medicine` ↔ `Substance`
 * с дозировкой конкретного вещества. Композитный PK `(medicine_id, substance_id)`,
 * CHECK `strength_value > 0` (SRS-DOM-013/017).
 */
import { sql } from 'drizzle-orm'
import { check, index, numeric, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'
import { medicines } from './medicines.js'
import { substances } from './substances.js'
import { dosageUnitEnum } from './dosage-unit.js'

export const MEDICINE_SUBSTANCES_TABLE = 'medicine_substances'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новую
// сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новую сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
export const medicineSubstances = pgTable(
  MEDICINE_SUBSTANCES_TABLE,
  {
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'cascade' }),
    substanceId: uuid('substance_id')
      .notNull()
      .references(() => substances.id, { onDelete: 'restrict' }),
    strengthValue: numeric('strength_value', { precision: 10, scale: 4 }).notNull(),
    strengthUnit: dosageUnitEnum('strength_unit').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.medicineId, table.substanceId] }),
    substanceIdIdx: index('ix_medicine_substances_substance_id').on(table.substanceId),
    strengthPositiveCheck: check(
      'chk_medicine_substances_strength_positive',
      sql`${table.strengthValue} > 0`,
    ),
  }),
)

export type MedicineSubstanceRow = typeof medicineSubstances.$inferSelect
export type MedicineSubstanceInsert = typeof medicineSubstances.$inferInsert
