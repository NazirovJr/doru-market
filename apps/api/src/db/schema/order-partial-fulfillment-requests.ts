/**
 * Drizzle-схема `order_partial_fulfillment_requests` (EP-12, DTJ-300, модуль 24 «Терминал
 * фармацевта», D-10, SRS-PHT-019..023a, `[РАСШИРЕНИЕ]`).
 *
 * Запрос подтверждения изменённого состава заказа клиентом — когда ≥1 позиция помечена
 * `unavailable` при сборке. Ровно один активный (`awaiting_customer`) запрос на заказ
 * (`uxOnePartialFulfillmentRequestActive`, частичный уникальный индекс). Создана миграцией
 * `0037_pharmacy_terminal_schema.sql`, DDL — 1:1 `docs/spec/24-module-pharmacy-terminal.md`
 * §«Дополнения к схеме БД».
 */
import { sql } from 'drizzle-orm'
import { bigint, check, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { partialFulfillmentStatusEnum } from './enums.schema.js'
import { orders } from './orders.js'
import { users } from './users.js'

export const ORDER_PARTIAL_FULFILLMENT_REQUESTS_TABLE = 'order_partial_fulfillment_requests'

export const orderPartialFulfillmentRequests = pgTable(
  ORDER_PARTIAL_FULFILLMENT_REQUESTS_TABLE,
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Фармацевт, вызвавший propose-partial-fulfillment (SRS-PHT-020).
    proposedBy: uuid('proposed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // [{ orderItemId, medicineName, quantity, reason }] недоступных позиций — см.
    // `PartialFulfillmentSnapshotItem` (apps/api/.../orders/domain/order-domain-event.ts).
    itemsSnapshot: jsonb('items_snapshot').notNull(),
    itemsTotalBeforeDiram: bigint('items_total_before_diram', { mode: 'bigint' }).notNull(),
    itemsTotalAfterDiram: bigint('items_total_after_diram', { mode: 'bigint' }).notNull(),
    refundAmountDiram: bigint('refund_amount_diram', { mode: 'bigint' }).notNull(),
    status: partialFulfillmentStatusEnum('status').notNull().default('awaiting_customer'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'chk_partial_fulfillment_amounts',
      sql`${table.itemsTotalAfterDiram} <= ${table.itemsTotalBeforeDiram} AND ${table.refundAmountDiram} = ${table.itemsTotalBeforeDiram} - ${table.itemsTotalAfterDiram}`,
    ),
    uniqueIndex('ux_partial_fulfillment_one_active')
      .on(table.orderId)
      .where(sql`${table.status} = 'awaiting_customer'`),
  ],
)

export type OrderPartialFulfillmentRequestRow = typeof orderPartialFulfillmentRequests.$inferSelect
export type OrderPartialFulfillmentRequestInsert = typeof orderPartialFulfillmentRequests.$inferInsert
