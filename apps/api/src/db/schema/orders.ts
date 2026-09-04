/**
 * Drizzle-схема `orders` / `order_items` / `favorites` (EP-09, DTJ-220).
 *
 * Полная DDL — 1:1 по `11-database-schema.md` Группа D (строки 694-816), применена миграцией
 * `0023_orders_cart.sql`. `Order`/`OrderItem` — доменный агрегат (EP-09 владеет
 * `modules/orders/domain/**`, DTJ-221/222) — эта схема лишь физическое хранение, домен читает
 * её ТОЛЬКО через свой репозиторий (`application/ports/*.repository.port.ts`, будущий тикет).
 *
 * `courier_id`/`prescription_id` — БЕЗ `.references()` (D-EP09-3, CTO-решение закрыто): таблицы
 * `couriers`/`prescriptions` физически не существуют — см. миграцию, раздел «ОТЛОЖЕНО».
 * `handover_otp_id` — ИСКЛЮЧЕНИЕ: получает нормальный `.references()` сразу, `otp_codes`
 * существует с миграции 0014 (D-EP09-7, поправка CTO к первоначальной группировке,
 * reports/EP09-CTO-BRIEF.md).
 *
 * `order_items.inventory_batch_id` ссылается на `pharmacy_inventory(id)`, НЕ на
 * `inventory_batches` (последней не существует ни в одной миграции EP-05 — обнаруженное
 * расхождение с каноническим DDL, см. миграцию и отчёт DTJ-220 `foundIssues`).
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { orderStatusEnum } from './enums.schema.js'
import { users } from './users.js'
import { pharmacies } from './pharmacies.js'
import { tenants } from './tenants.js'
import { medicines } from './medicines.js'
import { pharmacyInventory } from './pharmacy-inventory.js'
import { otpCodes } from './otp-codes.js'

export const ORDERS_TABLE = 'orders'

export const orders = pgTable(
  ORDERS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderNumber: varchar('order_number', { length: 20 }).notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id),
    status: orderStatusEnum('status').default('pending_payment'),
    paymentMethod: varchar('payment_method', { length: 50 }).notNull(),
    paymentTransactionId: varchar('payment_transaction_id', { length: 255 }),
    itemsTotalTjs: numeric('items_total_tjs', { precision: 10, scale: 2 }).notNull(),
    deliveryFeeTjs: numeric('delivery_fee_tjs', { precision: 10, scale: 2 }).notNull(),
    totalAmountTjs: numeric('total_amount_tjs', { precision: 10, scale: 2 }).notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryLandmark: text('delivery_landmark'),
    deliveryLatitude: numeric('delivery_latitude', { precision: 10, scale: 8 }),
    deliveryLongitude: numeric('delivery_longitude', { precision: 11, scale: 8 }),
    // FK → couriers(id) добавляется ALTER TABLE после CREATE TABLE couriers (EP-13, TODO(DTJ-313)).
    courierId: uuid('courier_id'),
    courierEtaMinutes: integer('courier_eta_minutes'),
    prescriptionImageUrl: text('prescription_image_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`NOW()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // TODO(R2-4): FK → prescriptions(id) добавляется ALTER TABLE, когда модуль рецептов будет
    // заведён. Модуль вне R1 — docs/04-SCOPE-DECISION-PIVOT.md строка 101 (D-EP09-8).
    prescriptionId: uuid('prescription_id'),
    cancelReason: varchar('cancel_reason', { length: 100 }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    slaDeadlineAt: timestamp('sla_deadline_at', { withTimezone: true }),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    // D-EP09-7: FK сразу, otp_codes существует с миграции 0014 — см. JSDoc выше.
    handoverOtpId: uuid('handover_otp_id').references(() => otpCodes.id, { onDelete: 'set null' }),
    checkoutAttemptId: uuid('checkout_attempt_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // РАСШИРЕНИЕ (DTJ-228, миграция 0028_orders_payments_extensions.sql, D-EP09-33/ADR
    // утверждён): снэпшот стратегии биллинга на момент checkout (SRS-DOM-162, SRS-RET-009) —
    // возврат (EP-11) читает ЭТУ колонку, не пересчитывает флаг тенанта задним числом. В R1
    // всегда 'single_invoice' (ResolveBillingStrategyService, TODO(DTJ-242/244) — split billing
    // недостижим без payment_operations.billing_component/tenant_settings.useSplitBilling).
    billingStrategy: varchar('billing_strategy', { length: 20 }).notNull().default('single_invoice'),
    // [cross-module, EP-13 DTJ-313] D.8 `25-module-courier-delivery.md` — паритет с
    // `user_addresses` (REQ-GEO-3, SRS-DELIV-010/041): курьерский экран навигации (CUJ-4) не может
    // показать подъезд/этаж/фото без этих полей. Заполняются use case'ом чекаута модуля `orders`
    // (вне периметра ЭТОГО тикета — только колонки); читаются модулем `delivery` ИСКЛЮЧИТЕЛЬНО
    // через `OrdersFacade.getDeliverySnapshot(orderId)`, не напрямую из таблицы (минимизация
    // связности). Согласование владельца `orders` — см. отчёт DTJ-313 «Открытые вопросы».
    deliveryEntrance: varchar('delivery_entrance', { length: 20 }),
    deliveryFloor: varchar('delivery_floor', { length: 20 }),
    deliveryApartment: varchar('delivery_apartment', { length: 20 }),
    deliveryComment: text('delivery_comment'),
    deliveryLandmarkPhotoUrl: text('delivery_landmark_photo_url'),
  },
  (table) => [
    check(
      'chk_orders_total_matches_sum',
      sql`${table.totalAmountTjs} = ${table.itemsTotalTjs} + ${table.deliveryFeeTjs}`,
    ),
    check(
      'chk_orders_billing_strategy_values',
      sql`${table.billingStrategy} IN ('single_invoice', 'split_items_delivery')`,
    ),
    check(
      'chk_orders_amounts_nonnegative',
      sql`${table.itemsTotalTjs} >= 0 AND ${table.deliveryFeeTjs} >= 0 AND ${table.totalAmountTjs} >= 0`,
    ),
  ],
)

export type OrderRow = typeof orders.$inferSelect
export type OrderInsert = typeof orders.$inferInsert

export const ORDER_ITEMS_TABLE = 'order_items'

export const orderItems = pgTable(
  ORDER_ITEMS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id').references(() => medicines.id),
    unitPriceTjs: numeric('unit_price_tjs', { precision: 10, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    totalPriceTjs: numeric('total_price_tjs', { precision: 10, scale: 2 }).notNull(),
    commissionBps: smallint('commission_bps').notNull().default(0),
    platformFeeDiram: bigint('platform_fee_diram', { mode: 'bigint' }).notNull().default(sql`0`),
    // Ссылается на pharmacy_inventory(id) — см. JSDoc файла («ОТКЛОНЕНИЕ ОТ КАНОНИЧЕСКОГО DDL»).
    inventoryBatchId: uuid('inventory_batch_id').references(() => pharmacyInventory.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check('chk_order_items_price_positive', sql`${table.unitPriceTjs} > 0`),
    check('chk_order_items_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'chk_order_items_total_matches',
      sql`${table.totalPriceTjs} = ${table.unitPriceTjs} * ${table.quantity}`,
    ),
  ],
)

export type OrderItemRow = typeof orderItems.$inferSelect
export type OrderItemInsert = typeof orderItems.$inferInsert

export const FAVORITES_TABLE = 'favorites'

export const favorites = pgTable(
  FAVORITES_TABLE,
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.medicineId] })],
)

export type FavoriteRow = typeof favorites.$inferSelect
export type FavoriteInsert = typeof favorites.$inferInsert
