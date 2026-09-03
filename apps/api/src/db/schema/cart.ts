/**
 * Drizzle-схема `cart` / `cart_items` (EP-09, DTJ-220).
 *
 * DDL — 1:1 по `11-database-schema.md` Группа D (строки 771-800), применена миграцией
 * `0023_orders_cart.sql`. Cart НЕ доменный агрегат (`tickets/00-EPICS.md`) — простое серверное
 * хранилище выбора товара до checkout; правила сплита по аптекам — `SplitCartByPharmacyUseCase`
 * (DTJ-223+), не эта схема.
 */
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { users } from './users.js'
import { medicines } from './medicines.js'
import { pharmacies } from './pharmacies.js'

export const CART_TABLE = 'cart'

export const cart = pgTable(
  CART_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // NULL для гостевой корзины (session_token).
    customerId: uuid('customer_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: varchar('session_token', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    check('chk_cart_owner', sql`${table.customerId} IS NOT NULL OR ${table.sessionToken} IS NOT NULL`),
  ],
)

export type CartRow = typeof cart.$inferSelect
export type CartInsert = typeof cart.$inferInsert

export const CART_ITEMS_TABLE = 'cart_items'

export const cartItems = pgTable(
  CART_ITEMS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => cart.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'cascade' }),
    // Цена/остаток различаются между аптеками — позиция привязана к КОНКРЕТНОЙ аптеке.
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    unique('unique_cart_medicine_pharmacy').on(table.cartId, table.medicineId, table.pharmacyId),
    check('chk_cart_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
)

export type CartItemRow = typeof cartItems.$inferSelect
export type CartItemInsert = typeof cartItems.$inferInsert
