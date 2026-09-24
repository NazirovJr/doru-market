/**
 * Drizzle-схема `courier_shifts` (EP-13, DTJ-313) — 1:1 `25-module-courier-delivery.md` §D.4.
 *
 * История смен (REQ-COUR-7 соседняя область). Разделяет «признание заработка» (`courier_earnings`
 * — вне периметра этого тикета, см. отчёт foundIssues) от «физического учёта наличных на руках»
 * (эта таблица). `discrepancy_diram != 0` логируется в `audit_log`
 * (`category='cash_reconciliation_discrepancy'`, см. миграцию D.7).
 */
import { sql } from 'drizzle-orm'
import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { courierShiftRecordStatusEnum } from './enums.schema.js'
import { couriers } from './couriers.js'
import { users } from './users.js'

export const COURIER_SHIFTS_TABLE = 'courier_shifts'

const ZERO_DIRAM = 0n

export const courierShifts = pgTable(
  COURIER_SHIFTS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => couriers.id, { onDelete: 'restrict' }),
    status: courierShiftRecordStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`NOW()`),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    openingCashOnHandDiram: bigint('opening_cash_on_hand_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
    /** Сумма `recordCash` за смену (`cash_courier`-заказы). */
    cashCollectedDiram: bigint('cash_collected_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
    /** Заполняется при закрытии смены (инкассация/сдача дежурному). */
    cashSubmittedDiram: bigint('cash_submitted_diram', { mode: 'bigint' }),
    /** `collected + opening - submitted`, заполняется при закрытии. */
    discrepancyDiram: bigint('discrepancy_diram', { mode: 'bigint' }),
    /** self или диспетчер. */
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
  },
  (table) => [
    // SRS-DELIV-006: ровно одна active-смена на курьера одновременно.
    uniqueIndex('ux_courier_shifts_one_active').on(table.courierId).where(sql`${table.status} = 'active'`),
  ],
)

/** DTJ-320 — тот же приём, что `SupportTicketRow`/`SupportTicketInsert` (`db/schema/support.ts`). */
export type CourierShiftRow = typeof courierShifts.$inferSelect
export type CourierShiftInsert = typeof courierShifts.$inferInsert
