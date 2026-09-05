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
import { orderItemFulfillmentStatusEnum, orderStatusEnum } from './enums.schema.js'
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
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
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
    // РАСШИРЕНИЕ (DTJ-253, миграция 0036_orders_payment_window_expires_at.sql): момент
    // истечения окна на оплату non-cash заказа в pending_payment (SRS-ORD-032/033/034).
    // Пишет ТОЛЬКО CheckoutUseCase/Order.create() (EP-09, вне владения EP-10/DTJ-253) — эта
    // колонка здесь для того, чтобы `orders.ts` не разошёлся с физической схемой БД (см.
    // JSDoc самой миграции). `UnpaidOrderTimeoutJob` (apps/worker) читает поле напрямую через
    // `pg.Pool` (не через этот Drizzle-схему), поэтому её отсутствие здесь не блокировало бы
    // джобу — колонка добавлена ради консистентности схемы, не как обязательная зависимость.
    paymentWindowExpiresAt: timestamp('payment_window_expires_at', { withTimezone: true }),
    // [РАСШИРЕНИЕ, EP-12, DTJ-300, модуль 24] — мягкая UX-блокировка «кто ведёт сборку»
    // (SRS-PHT-006/007/010/038), НЕ RBAC-контроль (тот остаётся orders:*:pharmacy). Заполняется
    // AcceptOrderUseCase/reclaim (DTJ-301+, вне этого тикета) — миграция 0041.
    assignedPharmacistId: uuid('assigned_pharmacist_id').references(() => users.id, { onDelete: 'set null' }),
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
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    medicineId: uuid('medicine_id').references(() => medicines.id),
    unitPriceTjs: numeric('unit_price_tjs', { precision: 10, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    totalPriceTjs: numeric('total_price_tjs', { precision: 10, scale: 2 }).notNull(),
    commissionBps: smallint('commission_bps').notNull().default(0),
    platformFeeDiram: bigint('platform_fee_diram', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    // Ссылается на pharmacy_inventory(id) — см. JSDoc файла («ОТКЛОНЕНИЕ ОТ КАНОНИЧЕСКОГО DDL»).
    inventoryBatchId: uuid('inventory_batch_id').references(() => pharmacyInventory.id, {
      onDelete: 'set null',
    }),
    // [РАСШИРЕНИЕ, EP-12, DTJ-300, модуль 24] — прогресс сканирования позиции терминалом
    // (SRS-PHT-011..020). Миграция 0037.
    fulfillmentStatus: orderItemFulfillmentStatusEnum('fulfillment_status').notNull().default('pending'),
    // Партия, ФАКТИЧЕСКИ отсканированная при сборке — может отличаться от `inventoryBatchId`
    // (FEFO-резерв) при замене партии (SRS-PHT-014). Как и `inventoryBatchId` выше — ссылается на
    // `pharmacy_inventory(id)`, НЕ на `inventory_batches` (foundIssue DTJ-220, `inventory_batches`
    // физически не существует ни в одной миграции — та же поправка, что уже применена к
    // `inventoryBatchId` выше; спецификация модуля 24 буквально называет колонку REFERENCES
    // `inventory_batches(id)`, что на этом кодовой базе некорректно).
    scannedBatchId: uuid('scanned_batch_id').references(() => pharmacyInventory.id, { onDelete: 'set null' }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    scannedBy: uuid('scanned_by').references(() => users.id, { onDelete: 'set null' }),
    scanMethod: varchar('scan_method', { length: 10 }),
    itemIssueReason: varchar('item_issue_reason', { length: 30 }),
  },
  (table) => [
    check('chk_order_items_price_positive', sql`${table.unitPriceTjs} > 0`),
    check('chk_order_items_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'chk_order_items_total_matches',
      sql`${table.totalPriceTjs} = ${table.unitPriceTjs} * ${table.quantity}`,
    ),
    check(
      'chk_order_items_scan_method',
      sql`${table.scanMethod} IN ('camera', 'manual') OR ${table.scanMethod} IS NULL`,
    ),
    check(
      'chk_order_items_item_issue_reason',
      sql`${table.itemIssueReason} IN ('out_of_stock', 'expired_on_shelf', 'damaged_packaging') OR ${table.itemIssueReason} IS NULL`,
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
