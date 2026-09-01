/**
 * Drizzle-схема `medicines` (DTJ-091, EP-04). 1:1 DDL из `11-database-schema.md`
 * строки 353-389, включая `search_vector` (генерируемая колонка, вес A — `trade_name`/
 * `inn_name`, вес C — `manufacturer_name`) и CHECK-инвариант `chk_medicines_control_
 * category_requires_rx` (SRS-DOM-015, дублирует доменную проверку).
 *
 * ВАЖНО (DTJ-091, риск): `drizzle-kit` может некорректно воспроизвести
 * `GENERATED ALWAYS AS (...) STORED` для `search_vector`; миграция проверена вручную.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { categories, CATEGORIES_TABLE } from './categories.js'
import { controlCategoryEnum } from './control-category.js'
import { dosageFormClassEnum } from './dosage-form-class.js'
import { dosageUnitEnum } from './dosage-unit.js'

export const MEDICINES_TABLE = 'medicines'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новую
// сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новую сигнатуру (массив extras) — в Drizzle 1.0. Подавляем до апгрейда.
export const medicines = pgTable(
  MEDICINES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tradeName: varchar('trade_name', { length: 255 }).notNull(),
    innName: varchar('inn_name', { length: 255 }).notNull(),
    barcode: varchar('barcode', { length: 64 }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    dosageForm: varchar('dosage_form', { length: 100 }).notNull(),
    dosageStrength: varchar('dosage_strength', { length: 100 }).notNull(),
    manufacturerCountry: varchar('manufacturer_country', { length: 100 }).notNull(),
    manufacturerName: varchar('manufacturer_name', { length: 255 }).notNull(),
    isPrescriptionRequired: boolean('is_prescription_required').notNull().default(false),
    storageTemperature: varchar('storage_temperature', { length: 50 }),
    descriptionTj: text('description_tj'),
    descriptionRu: text('description_ru'),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // [РАСШИРЕНИЕ D-06/D-07/D-08] --
    dosageFormClass: dosageFormClassEnum('dosage_form_class').notNull().default('other'),
    dosageValue: numeric('dosage_value', { precision: 10, scale: 4 }),
    dosageUnit: dosageUnitEnum('dosage_unit'),
    controlCategory: controlCategoryEnum('control_category').notNull().default('none'),
    isGloballyIdentifiableByBarcode: boolean('is_globally_identifiable_by_barcode')
      .notNull()
      .default(true),
    isPublished: boolean('is_published').notNull().default(false),
    requiresColdChain: boolean('requires_cold_chain').notNull().default(false),
    searchVector: text('search_vector'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    barcodeUniq: index('ux_medicines_barcode').on(table.barcode).where(sql`${table.barcode} IS NOT NULL`),
    categoryIdx: index('ix_medicines_category_id').on(table.categoryId),
    controlCategoryPartialIdx: index('ix_medicines_control_category')
      .on(table.controlCategory)
      .where(sql`${table.controlCategory} IN ('psychotropic','narcotic')`),
    isPublishedPartialIdx: index('ix_medicines_published')
      .on(table.isPublished)
      .where(sql`${table.isPublished} = true`),
    checkControlCategoryRequiresRx: check(
      'chk_medicines_control_category_requires_rx',
      sql`${table.controlCategory} NOT IN ('potent','psychotropic','narcotic') OR ${table.isPrescriptionRequired} = true`,
    ),
  }),
)

export type MedicineRow = typeof medicines.$inferSelect
export type MedicineInsert = typeof medicines.$inferInsert

export const MEDICINES_CATEGORY_FK = `${MEDICINES_TABLE}_category_id_fkey`
export const _fkCategoriesNote = CATEGORIES_TABLE
