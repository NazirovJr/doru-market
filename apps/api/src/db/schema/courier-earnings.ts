/**
 * Drizzle-схема `courier_earnings` (EP-13, DTJ-321) — 1:1 `11-database-schema.md` §34. Append-only:
 * признаётся В МОМЕНТ `delivered` (`DeliveryCompletedEvent -> billing.recordEarning`, REQ-COUR-5),
 * НЕЗАВИСИМО от `hold_period_days` выплаты аптеке — два несвязанных таймлайна. Только для
 * `couriers.chain_id IS NULL` (platform_pool) — own_fleet курьеры не имеют строк здесь
 * (REQ-COUR-3: `delivery_fee_tjs` целиком выручка тенанта).
 *
 * **foundIssue, не домысел этого тикета** — см. JSDoc `courier-payouts.ts` (тот же гэп, тот же
 * источник: `0042_delivery_module_schema.sql`/`docs/STATE-AND-RESUME-POINT.md`). DTJ-321
 * (`GET /courier-earnings`, SRS-DELIV-030) — READ-ONLY: создаёт таблицу СТРУКТУРНО, не пишет в неё
 * (вставка строки — `DeliveryCompletedEvent`-обработчик, вне периметра READ-ONLY тикета, владелец
 * не определён на момент этого тикета — см. отчёт сдачи).
 */
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
    /** REQ-COUR-5: обязателен, дедупликация `DeliveryCompletedEvent`-обработчика (at-least-once). */
    idempotencyKey: varchar('idempotency_key', { length: IDEMPOTENCY_KEY_MAX_LENGTH }).notNull().unique(),
    /** `true` => `courier_return_fee_diram` (REQ-RET-7), не обычная доставка. */
    isReturnFee: boolean('is_return_fee').notNull().default(false),
    payoutBatchId: uuid('payout_batch_id').references(() => courierPayouts.id, { onDelete: 'set null' }),
    recognizedAt: timestamp('recognized_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [check('chk_courier_earnings_amount_positive', sql`${table.amountDiram} > 0`)],
)

export type CourierEarningRow = typeof courierEarnings.$inferSelect
export type CourierEarningInsert = typeof courierEarnings.$inferInsert
