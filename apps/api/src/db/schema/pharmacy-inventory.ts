/**
 * Drizzle-схема `pharmacy_inventory` (EP-05, DTJ-141, частично DTJ-143).
 *
 * Одна строка = один остаток конкретного препарата в конкретной аптеке
 * с конкретным сроком годности и серией. Цена — целые дирамы (J7).
 *
 * DDL — из `11-database-schema.md` §inventory (SRS-INV-001..005):
 *   - `medicine_id` FK на `medicines.id` (каталог, EP-04).
 *   - `pharmacy_id` FK на `pharmacies.id` (EP-03, сеть/аптека).
 *   - `price` INTEGER, ≥ 0 (J7, D-13: только integer dirams).
 *   - `quantity` INTEGER, ≥ 0 (нет в наличии = 0).
 *   - `expires_at` DATE NOT NULL.
 *   - `batch_number` VARCHAR — опциональная серия производителя.
 *   - UNIQUE (pharmacy_id, medicine_id, batch_number, expires_at) — FEFO: один и тот
 *     же лот не дублируется.
 *   - Индексы для hot-path:
 *       (pharmacy_id, medicine_id) — `GET /medicines/:id` (показать остатки).
 *       (pharmacy_id, expires_at) — FEFO сортировка.
 *
 * Тенантный скоуп — на уровне запросов (`tenant_id` + RLS), не на уровне схемы
 * (схема мульти-тенантная, tenant_id добавляется миграцией EP-15).
 */
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { medicines } from './medicines.js'
import { pharmacies } from './pharmacies.js'

export const PHARMACY_INVENTORY_TABLE = 'pharmacy_inventory'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const pharmacyInventory = pgTable(
  PHARMACY_INVENTORY_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'restrict' }),
    price: integer('price').notNull(),
    quantity: integer('quantity').notNull().default(0),
    expiresAt: date('expires_at').notNull(),
    batchNumber: varchar('batch_number', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqFefo: uniqueIndex('ux_pharmacy_inventory_fefo').on(
      table.pharmacyId,
      table.medicineId,
      table.batchNumber,
      table.expiresAt,
    ),
    byMedicineIdx: index('ix_pharmacy_inventory_by_medicine').on(
      table.pharmacyId,
      table.medicineId,
    ),
    byExpiryIdx: index('ix_pharmacy_inventory_by_expiry').on(table.pharmacyId, table.expiresAt),
    nonNegPrice: check('chk_pharmacy_inventory_price_nonneg', sql`${table.price} >= 0`),
    nonNegQuantity: check(
      'chk_pharmacy_inventory_quantity_nonneg',
      sql`${table.quantity} >= 0`,
    ),
  }),
)

export type PharmacyInventoryRow = typeof pharmacyInventory.$inferSelect
export type PharmacyInventoryInsert = typeof pharmacyInventory.$inferInsert
