/**
 * Drizzle-схема `user_addresses` (EP-01, DTJ-014).
 *
 * Адреса доставки пользователя. Связь 1:N (один пользователь — несколько адресов,
 * флаг `is_default` выделяет «основной»). `ON DELETE CASCADE` от `users` (этот
 * FK НЕ отложен — `users` уже существует в этом же тикете).
 *
 * Координаты — `numeric(10,8)` / `numeric(11,8)` (Drizzle `numeric`),
 * в Postgres они хранятся как `NUMERIC` (arbitrary precision, не float — критично
 * для гео-поиска EP-06).
 *
 * @see tickets/ep01-foundation/DTJ-014.md
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  numeric,
  pgTable,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

const TIMESTAMPTZ = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'timestamp with time zone'
  },
})

export const USER_ADDRESSES_TABLE = 'user_addresses'

export const userAddresses = pgTable(USER_ADDRESSES_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  addressText: text('address_text').notNull(),
  landmarkText: text('landmark_text'),
  landmarkPhotoUrl: text('landmark_photo_url'),
  entrance: varchar('entrance', { length: 16 }),
  floor: varchar('floor', { length: 16 }),
  apartment: varchar('apartment', { length: 16 }),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: TIMESTAMPTZ('created_at').default(sql`NOW()`),
})

export type UserAddressRow = typeof userAddresses.$inferSelect
export type UserAddressInsert = typeof userAddresses.$inferInsert
