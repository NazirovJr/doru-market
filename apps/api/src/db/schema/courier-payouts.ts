/**
 * Drizzle-схема `courier_payouts` (EP-13, DTJ-321) — 1:1 `11-database-schema.md` §36.
 *
 * **foundIssue, не домысел этого тикета:** таблица физически не существовала ни в одной миграции
 * ДО этого файла — «остаток Группы H», явно вне периметра DTJ-313 (`0042_delivery_module_schema.sql`
 * JSDoc: «foundIssue зафиксирован в отчёте для владельца DTJ-320/321») и подтверждён
 * `docs/STATE-AND-RESUME-POINT.md`: «courier_earnings/tenant_courier_payout_rules/courier_payouts
 * (остаток Группы H) — по-прежнему не существуют, нужны DTJ-320/321». DTJ-321 — READ-ONLY эндпоинты
 * (`GET /courier-payouts`, SRS-DELIV-031) поверх этой таблицы — создаётся здесь СТРУКТУРНО (эта
 * схема + миграция), генерация батчей (запись `status='issued'|'paid'`) — вне периметра (см. JSDoc
 * тикета/риски): физическая выплата — вероятная зона `apps/worker/src/jobs/payout/**` (EP-10, по
 * аналогии с `escrow-timeouts`), НЕ реализуется здесь.
 *
 * `tenant_courier_payout_rules` (формула расчёта `courier_earnings.amount_diram`, REQ-COUR-4) —
 * СОЗНАТЕЛЬНО НЕ создаётся этим тикетом: нужна только write-стороне признания заработка
 * (`DeliveryCompletedEvent -> billing.recordEarning`), которая тоже вне периметра READ-ONLY
 * DTJ-321 — остаётся открытым гэпом для владельца этого будущего обработчика.
 */
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
    /** REQ-COUR-7: сумма наличных, собранных курьером за `cash_courier`-заказы, вычитается из батча. */
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
