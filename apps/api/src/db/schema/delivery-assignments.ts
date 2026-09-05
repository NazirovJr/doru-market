/**
 * Drizzle-схема `delivery_assignments` (EP-13, DTJ-313).
 *
 * **foundIssue** (см. `couriers.ts` для полного разбора): таблица физически НЕ существовала ни в
 * одной миграции до этого тикета — «Группа H» запланирована, не реализована. 1:1 транскрипция
 * канонического DDL §33 (`11-database-schema.md`) + расширение D.2 `25-module-courier-delivery.md`.
 *
 * **ОТКЛОНЕНИЕ от канонического DDL**: `delivery_geo_point GEOGRAPHY(POINT,4326)` (снапшот точки
 * доставки) — НЕ добавлена. `postgis` НЕ ставится в образ `postgres:16` этого окружения
 * (`pg_available_extensions` — 0 строк, независимо подтверждено ЗДЕСЬ и уже задокументировано
 * `pharmacies.ts`/DTJ-195 постмортем + `migrations/0022_pharmacies_lat_lon_index.sql` — тот же
 * вывод, тот же образ, другой тикет). Колонка была бы к тому же ЧИСТО избыточна: точка доставки
 * уже снапшотится `orders.delivery_latitude/longitude` (Группа D) — модуль `delivery` читает её
 * через `OrdersFacade.getDeliverySnapshot(orderId)` (D.8, SRS-DELIV-041), не дублирует здесь.
 * `ix_delivery_assignments_geo_point` (GiST) — соответственно тоже не создаётся (нет колонки).
 *
 * `courier_id` — nullable (`unassigned` пока не назначен). `status` — FSM, единственный источник
 * допустимости перехода — `modules/delivery/domain/delivery-assignment.state-machine.ts`.
 *
 * D.2 (SRS-DELIV-004): `requires_cold_chain` — СНАПШОТ на момент создания (не живой JOIN, стабильность
 * аудита). `contact_attempts_count`/`last_contact_attempt_at` — счётчик попыток связаться с клиентом.
 */
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { deliveryAssignmentStatusEnum } from './enums.schema.js'
import { couriers } from './couriers.js'
import { orders } from './orders.js'
import { otpCodes } from './otp-codes.js'
import { users } from './users.js'

export const DELIVERY_ASSIGNMENTS_TABLE = 'delivery_assignments'

export const deliveryAssignments = pgTable(
  DELIVERY_ASSIGNMENTS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    courierId: uuid('courier_id').references(() => couriers.id, { onDelete: 'set null' }),
    status: deliveryAssignmentStatusEnum('status').notNull().default('unassigned'),
    landmarkText: text('landmark_text'),
    handoverOtpId: uuid('handover_otp_id').references(() => otpCodes.id, { onDelete: 'set null' }),
    cashCollectedDiram: bigint('cash_collected_diram', { mode: 'bigint' }),
    cashChangeDiram: bigint('cash_change_diram', { mode: 'bigint' }),
    reassignReason: text('reassign_reason'),
    reassignedBy: uuid('reassigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    pickedUpFromPharmacyAt: timestamp('picked_up_from_pharmacy_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
    // ---- D.2 (SRS-DELIV-004) ----
    requiresColdChain: boolean('requires_cold_chain').notNull().default(false),
    coldChainBagConfirmed: boolean('cold_chain_bag_confirmed'),
    coldChainBagConfirmedAt: timestamp('cold_chain_bag_confirmed_at', { withTimezone: true }),
    contactAttemptsCount: integer('contact_attempts_count').notNull().default(0),
    lastContactAttemptAt: timestamp('last_contact_attempt_at', { withTimezone: true }),
    /** Снапшот дистанции аптека→клиент на момент создания (аудит `delivery_fee`), метры. */
    distanceMeters: integer('distance_meters'),
  },
  (table) => [
    check(
      'chk_delivery_cash_matches',
      sql`${table.cashCollectedDiram} IS NULL OR ${table.cashCollectedDiram} >= COALESCE(${table.cashChangeDiram}, 0)`,
    ),
    // SRS-DOM-036: только одно НЕТЕРМИНАЛЬНОЕ назначение на order_id одновременно.
    uniqueIndex('ux_delivery_assignment_one_active')
      .on(table.orderId)
      .where(sql`${table.status} NOT IN ('delivered', 'delivery_failed')`),
    index('ix_delivery_assignments_order').on(table.orderId),
    index('ix_delivery_assignments_courier_active')
      .on(table.courierId, table.status)
      .where(sql`${table.status} NOT IN ('delivered', 'delivery_failed')`),
  ],
)
