/**
 * Drizzle-схема «Группа E» (EP-10, DTJ-236): `escrow_ledger` / `payout_schedule` /
 * `platform_fee` / `payment_operations`. DDL 1:1 `11-database-schema.md` строки 812-928,
 * применена миграцией `0029_payments.sql`. `EscrowLedger`/`PayoutSchedule` — доменные
 * агрегаты (EP-10 владеет `modules/payments/domain/**`, тикеты DTJ-243+) — эта схема лишь
 * физическое хранение, домен читает её ТОЛЬКО через свой репозиторий
 * (`application/ports/*.repository.port.ts`, будущие тикеты).
 *
 * `payoutSchedule.heldByDisputeId` — БЕЗ `.references()` (тот же приём, что
 * `orders.courierId`/`orders.prescriptionId` в `db/schema/orders.ts`): `order_disputes`
 * физически не существует ни в одной миграции EP-09/EP-10 — FK добавляется `ALTER TABLE`
 * миграцией EP-11/14, когда таблица появится (см. комментарий в `0029_payments.sql`).
 *
 * Денежные поля — `bigint('...', { mode: 'bigint' })` (правило 6 AGENTS.md: целые дирамы,
 * никогда `float`), тот же приём, что `order_items.platformFeeDiram` в `db/schema/orders.ts`.
 */
import { sql } from 'drizzle-orm'
import { bigint, date, jsonb, pgTable, smallint, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import {
  billingInvoiceStatusEnum,
  billingInvoiceTypeEnum,
  escrowEntryDirectionEnum,
  escrowEntryTypeEnum,
  paymentOperationStatusEnum,
  paymentOperationTypeEnum,
  payoutStatusEnum,
} from './enums.schema.js'
import { orders } from './orders.js'
import { pharmacies } from './pharmacies.js'
import { tenants } from './tenants.js'
import { pharmacyChains } from './pharmacy-chains.js'
import { users } from './users.js'

export const ESCROW_LEDGER_TABLE = 'escrow_ledger'

/** SRS-DOM-031: append-only — репозиторий (будущий тикет) экспонирует ТОЛЬКО append()/read. */
export const escrowLedger = pgTable(ESCROW_LEDGER_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  entryType: escrowEntryTypeEnum('entry_type').notNull(),
  direction: escrowEntryDirectionEnum('direction').notNull(),
  amountDiram: bigint('amount_diram', { mode: 'bigint' }).notNull(),
  paymentTransactionRef: varchar('payment_transaction_ref', { length: 255 }),
  reason: text('reason'),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
})

export const PAYOUT_SCHEDULE_TABLE = 'payout_schedule'

export const payoutSchedule = pgTable(PAYOUT_SCHEDULE_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: 'cascade' }),
  pharmacyId: uuid('pharmacy_id')
    .notNull()
    .references(() => pharmacies.id, { onDelete: 'restrict' }),
  status: payoutStatusEnum('status').notNull().default('pending'),
  grossAmountDiram: bigint('gross_amount_diram', { mode: 'bigint' }).notNull(),
  commissionDiram: bigint('commission_diram', { mode: 'bigint' }).notNull(),
  netAmountDiram: bigint('net_amount_diram', { mode: 'bigint' }).notNull(),
  holdPeriodDays: smallint('hold_period_days').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  // FK → order_disputes(id) добавляется ALTER TABLE миграцией EP-11/14 (см. JSDoc файла/0029_payments.sql).
  heldByDisputeId: uuid('held_by_dispute_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  payoutBatchRef: varchar('payout_batch_ref', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`NOW()`),
})

export const PLATFORM_FEE_TABLE = 'platform_fee'

export const platformFee = pgTable(PLATFORM_FEE_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'cascade' }),
  commissionCategory: varchar('commission_category', { length: 20 }),
  commissionBps: smallint('commission_bps').notNull(),
  effectiveFrom: date('effective_from').notNull().default(sql`CURRENT_DATE`),
  effectiveTo: date('effective_to'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
})

export const PAYMENT_OPERATIONS_TABLE = 'payment_operations'

export const paymentOperations = pgTable(PAYMENT_OPERATIONS_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  operationType: paymentOperationTypeEnum('operation_type').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  provider: varchar('provider', { length: 30 }).notNull(),
  providerRef: varchar('provider_ref', { length: 255 }),
  status: paymentOperationStatusEnum('status').notNull().default('pending'),
  amountDiram: bigint('amount_diram', { mode: 'bigint' }).notNull(),
  rawWebhookPayload: jsonb('raw_webhook_payload'),
  // DTJ-241 (0032_payment_operations_invoice_cache.sql) — персистируются CreatePaymentInvoiceUseCase
  // ПОСЛЕ успешного PaymentProvider.createInvoice(), см. JSDoc миграции/use case.
  qrPayload: text('qr_payload'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`NOW()`),
})

/**
 * ДОБАВЛЕНО (DTJ-251) — таблица НЕ входила в базовую схему DTJ-236 вопреки тексту тикета
 * DTJ-251, см. JSDoc `0038_platform_billing_invoices.sql`. `CONSTRAINT uq_billing_invoices_
 * chain_type_period` (миграция) НЕ повторена здесь декларативно — тот же минималистичный
 * приём, что остальные три таблицы этого файла (constraint'ы живут в миграции, эта схема
 * только физическое хранение/типы колонок для Drizzle query builder, см. JSDoc файла).
 * `DrizzlePlatformBillingInvoiceRepository.upsertDraft` передаёт `target` в
 * `onConflictDoUpdate` явно колонками — не требует декларации constraint'а в ЭТОМ объекте,
 * только его физического существования в БД (мигрирован).
 */
export const PLATFORM_BILLING_INVOICES_TABLE = 'platform_billing_invoices'

export const platformBillingInvoices = pgTable(PLATFORM_BILLING_INVOICES_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  chainId: uuid('chain_id')
    .notNull()
    .references(() => pharmacyChains.id, { onDelete: 'restrict' }),
  invoiceType: billingInvoiceTypeEnum('invoice_type').notNull(),
  status: billingInvoiceStatusEnum('status').notNull().default('draft'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  subtotalDiram: bigint('subtotal_diram', { mode: 'bigint' }).notNull(),
  vatDiram: bigint('vat_diram', { mode: 'bigint' }).notNull().default(sql`0`),
  totalDiram: bigint('total_diram', { mode: 'bigint' }).notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
})
