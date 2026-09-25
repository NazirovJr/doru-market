/**
 * Drizzle-схема `delivery_offers` (EP-13, DTJ-313) — 1:1 `25-module-courier-delivery.md` §D.3.
 *
 * Очередь последовательных предложений курьерам (REQ-DELIV-2). Один `pending` оффер на назначение
 * одновременно (частичный уникальный индекс). Эскалация — новая строка `sequence_no+1`, старая
 * помечается `expired`. НЕ путать с `delivery_assignments.status` — назначение остаётся
 * `unassigned`, пока ни один оффер не принят (SRS-DELIV-005).
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, numeric, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { deliveryOfferStatusEnum } from './enums.schema.js'
import { couriers } from './couriers.js'
import { deliveryAssignments } from './delivery-assignments.js'

export const DELIVERY_OFFERS_TABLE = 'delivery_offers'

export const deliveryOffers = pgTable(
  DELIVERY_OFFERS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    deliveryAssignmentId: uuid('delivery_assignment_id')
      .notNull()
      .references(() => deliveryAssignments.id, { onDelete: 'cascade' }),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => couriers.id, { onDelete: 'restrict' }),
    /** 1..N по порядку эскалации. */
    sequenceNo: integer('sequence_no').notNull(),
    status: deliveryOfferStatusEnum('status').notNull().default('pending'),
    distanceMeters: integer('distance_meters').notNull(),
    /** Итоговый скор алгоритма на момент оффера (аудит/объяснимость, SRS-DELIV-038). */
    score: numeric('score', { precision: 6, scale: 4 }).notNull(),
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().default(sql`NOW()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    declineReason: varchar('decline_reason', { length: 100 }),
  },
  (table) => [
    check('chk_delivery_offers_sequence_positive', sql`${table.sequenceNo} > 0`),
    uniqueIndex('ux_delivery_offers_one_pending_per_assignment')
      .on(table.deliveryAssignmentId)
      .where(sql`${table.status} = 'pending'`),
    index('ix_delivery_offers_courier_pending')
      .on(table.courierId)
      .where(sql`${table.status} = 'pending'`),
  ],
)

export type DeliveryOfferRow = typeof deliveryOffers.$inferSelect
export type DeliveryOfferInsert = typeof deliveryOffers.$inferInsert
