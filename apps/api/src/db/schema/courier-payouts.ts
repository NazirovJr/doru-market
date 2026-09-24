import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { courierPayoutBatchStatusEnum } from './enums.schema.js'
import { couriers } from './couriers.js'

export const COURIER_PAYOUTS_TABLE = 'courier_payouts'

const ZERO_DIRAM = 0n

export const courierPayouts = pgTable(
  COURIER_PAYOUTS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => couriers.id, { onDelete: 'restrict' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    totalAmountDiram: bigint('total_amount_diram', { mode: 'bigint' }).notNull(),
    cashRemittanceOffsetDiram: bigint('cash_remittance_offset_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
    status: courierPayoutBatchStatusEnum('status').notNull().default('draft'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [
    check('chk_courier_payouts_period', sql`${table.periodEnd} > ${table.periodStart}`),
    check('chk_courier_payouts_amount_nonneg', sql`${table.totalAmountDiram} >= 0`),
  ],
)

export type CourierPayoutRow = typeof courierPayouts.$inferSelect
export type CourierPayoutInsert = typeof courierPayouts.$inferInsert
