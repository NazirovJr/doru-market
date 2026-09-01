/**
 * Drizzle-схема `pharmacy_sku_mapping` (EP-05, DTJ-146, SRS-INV-021..023).
 *
 * Кэш «однажды сматченного» — связь `(pharmacy_id, internal_sku) → medicine_id`
 * + как было сматчено (для аудита модерации). Используется
 * `CompositeInventoryMatcherService` (DTJ-146) для раннего выхода в
 * уже разрешённых строках, БЕЗ обращения к medicines.
 *
 * UNIQUE `(pharmacy_id, internal_sku)` — гарантирует идемпотентность
 * upsert. `matched_via` — `enum`-like VARCHAR(16) с CHECK, чтобы в БД
 * не попали мусорные значения. Прямой `pgEnum` не делаем (см. комментарий
 * в `enums.schema.ts` о конвенции CHECK над varchar).
 */
import { sql } from 'drizzle-orm'
import { check, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { medicines } from './medicines.js'
import { pharmacies } from './pharmacies.js'

export const PHARMACY_SKU_MAPPING_TABLE = 'pharmacy_sku_mapping'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const pharmacySkuMapping = pgTable(
  PHARMACY_SKU_MAPPING_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    internalSku: varchar('internal_sku', { length: 64 }).notNull(),
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'restrict' }),
    matchedVia: varchar('matched_via', { length: 16 }).notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (table) => ({
    // UNIQUE `(pharmacy_id, internal_sku)` — критично для upsert-
    // семантики (SRS-INV-023): повторный матч той же строки
    // ОБНОВЛЯЕТ `medicine_id`/`matched_via`/`matched_at`, а не
    // создаёт дубль.
    pharmacySkuIdx: uniqueIndex('ux_pharmacy_sku_mapping_pharmacy_sku').on(
      table.pharmacyId,
      table.internalSku,
    ),
    matchedViaCheck: check(
      'chk_pharmacy_sku_mapping_matched_via',
      sql`${table.matchedVia} IN ('barcode','name_fuzzy','manual_resolve')`,
    ),
  }),
)

export type PharmacySkuMappingRow = typeof pharmacySkuMapping.$inferSelect
export type PharmacySkuMappingInsert = typeof pharmacySkuMapping.$inferInsert
