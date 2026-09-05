/**
 * Drizzle-схема `courier_ratings` (EP-13, DTJ-313) — 1:1 `25-module-courier-delivery.md` §D.5.
 *
 * Оценка доступна `customer` только для заказов в статусе `delivered`, один раз на заказ
 * (`UNIQUE(order_id)`). Создание строки атомарно инкрементирует `couriers.rating_count` и
 * пересчитывает `rating_avg` — application-слой (DTJ-314+), не эта таблица.
 */
import { sql } from 'drizzle-orm'
import { check, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { couriers } from './couriers.js'
import { orders } from './orders.js'
import { users } from './users.js'

export const COURIER_RATINGS_TABLE = 'courier_ratings'

export const courierRatings = pgTable(
  COURIER_RATINGS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => couriers.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [check('chk_courier_ratings_range', sql`${table.rating} BETWEEN 1 AND 5`)],
)
