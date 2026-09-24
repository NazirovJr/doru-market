/**
 * Drizzle-схема `couriers` (EP-13, DTJ-313).
 *
 * **НАЙДЕНО ПРИ ПОДГОТОВКЕ ЭТОЙ МИГРАЦИИ (foundIssue, не домысел тикета):** `couriers` физически
 * НЕ существует ни в одной миграции ДО этого тикета — «Группа H» (`11-database-schema.md` строки
 * 1083-1207, файл планировался как `0012_delivery.sql`) была ЗАПЛАНИРОВАНА фундаментом EP-01, но
 * фактически НИКОГДА не реализована (`0012` занят `0012_inventory_foundation.sql` — другой
 * тикет). Подтверждено: `grep -rn "CREATE TABLE couriers" apps/api/migrations` — пусто;
 * `apps/api/migrations/0023_orders_cart.sql` строки 34-40 и 175-177 явно документируют это как
 * известный, осознанный пробел («ОТЛОЖЕНО... FK на них добавится отдельным ALTER TABLE ниже,
 * когда соответствующий модуль создаст свою таблицу»). Эта схема — 1:1 транскрипция
 * канонического DDL Группы H (§32) + расширение D.1 `25-module-courier-delivery.md` — СОЗДАЁТ
 * таблицу впервые, не редактирует существующую.
 *
 * `chainId IS NULL` ⇒ курьер платформенного пула (REQ-COUR-1/2); заполнено ⇒ собственный флот
 * сети, обслуживает ТОЛЬКО её заказы (SRS-DOM-037). `pending_verification` не может быть назначен
 * ни на один заказ (SRS-DOM-137, REQ-COUR-10).
 *
 * D.1: `last_known_*`/`shift_status`/`rating_*`/`current_cash_on_hand_diram` — SRS-DELIV-003.
 */
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import {
  courierShiftStatusEnum,
  courierStatusEnum,
  courierTaxStatusEnum,
  courierVehicleTypeEnum,
} from './enums.schema.js'
import { pharmacyChains } from './pharmacy-chains.js'
import { users } from './users.js'

export const COURIERS_TABLE = 'couriers'

/** Дефолт `couriers.rating_avg` (D.1) — новый курьер начинает с максимального рейтинга, пока не
 * накопил историю оценок; снижается по мере поступления реальных `courier_ratings`. */
const DEFAULT_RATING_AVG = '5.00'
const ZERO_DIRAM = 0n

export const couriers = pgTable(
  COURIERS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'set null' }),
    status: courierStatusEnum('status').notNull().default('pending_verification'),
    taxStatus: courierTaxStatusEnum('tax_status').notNull(),
    taxStatusDocumentUrl: text('tax_status_document_url'),
    vehicleType: courierVehicleTypeEnum('vehicle_type').notNull(),
    coldChainCertified: boolean('cold_chain_certified').notNull().default(false),
    healthCertificateUrl: text('health_certificate_url'),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
    // ---- D.1 (SRS-DELIV-003) ----
    lastKnownLatitude: numeric('last_known_latitude', { precision: 10, scale: 8 }),
    lastKnownLongitude: numeric('last_known_longitude', { precision: 11, scale: 8 }),
    lastLocationAt: timestamp('last_location_at', { withTimezone: true }),
    shiftStatus: courierShiftStatusEnum('shift_status').notNull().default('off_shift'),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default(DEFAULT_RATING_AVG),
    ratingCount: integer('rating_count').notNull().default(0),
    currentCashOnHandDiram: bigint('current_cash_on_hand_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
  },
  (table) => [
    check('chk_couriers_rating_range', sql`${table.ratingAvg} >= 0 AND ${table.ratingAvg} <= 5`),
    check('chk_couriers_cash_nonneg', sql`${table.currentCashOnHandDiram} >= 0`),
  ],
)

export type CourierRow = typeof couriers.$inferSelect
export type CourierInsert = typeof couriers.$inferInsert
