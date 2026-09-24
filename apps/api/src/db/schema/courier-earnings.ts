import { sql } from 'drizzle-orm'
import { bigint, boolean, check, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { couriers } from './couriers.js'
import { deliveryAssignments } from './delivery-assignments.js'
import { courierPayouts } from './courier-payouts.js'

export const COURIER_EARNINGS_TABLE = 'courier_earnings'

const IDEMPOTENCY_KEY_MAX_LENGTH = 255

export const courierEarnings = pgTable(
  COURIER_EARNINGS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => couriers.id, { onDelete: 'restrict' }),
    deliveryAssignmentId: uuid('delivery_assignment_id')
      .notNull()
      .references(() => deliveryAssignments.id, { onDelete: 'restrict' }),
    amountDiram: bigint('amount_diram', { mode: 'bigint' }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: IDEMPOTENCY_KEY_MAX_LENGTH }).notNull().unique(),
    isReturnFee: boolean('is_return_fee').notNull().default(false),
    payoutBatchId: uuid('payout_batch_id').references(() => courierPayouts.id, { onDelete: 'set null' }),
    recognizedAt: timestamp('recognized_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [check('chk_courier_earnings_amount_positive', sql`${table.amountDiram} > 0`)],
)

export type CourierEarningRow = typeof courierEarnings.$inferSelect
export type CourierEarningInsert = typeof courierEarnings.$inferInsert
