/**
 * Drizzle-схема `inventory_sync_errors` (EP-05, DTJ-145, SRS-INV-011).
 *
 * Построчные ошибки батча синхронизации остатков — отдельно от
 * `inventory_sync_batch.error_summary` (JSONB-агрегат «сколько строк
 * упало и почему в целом»). Требование продукта: аптека грузит выгрузку
 * на 900 позиций, одна строка с битой ценой не роняет батч — остальные
 * 899 применяются, а проблемная строка попадает СЮДА, чтобы аптека
 * увидела её в кабинете и исправила.
 *
 * `errorCode` — VARCHAR + CHECK (не pg enum), по конвенции соседней
 * `inventory_sync_batch` (0012_inventory_foundation.sql): `ALTER TYPE ...
 * ADD VALUE` не транзакционен, это уже дало проблему (см. удалённые
 * pgEnum `inventory_sync_row_error_code` + миграцию 0015b). Источник
 * истины по значениям — TS-юнион `InventorySyncRowError['errorCode']`
 * (`application/ports/inventory-sync-batch.repository.port.ts`), CHECK
 * ниже обязан оставаться синхронным с ним.
 */
import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { inventorySyncBatch } from './inventory-sync-batch.js'

export const INVENTORY_SYNC_ERRORS_TABLE = 'inventory_sync_errors'

export const inventorySyncErrors = pgTable(
  INVENTORY_SYNC_ERRORS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK на batch с CASCADE — удаление батча (например, watchdog зависших
    // full-sync сессий, DTJ-152) забирает и его построчные ошибки.
    batchId: uuid('batch_id')
      .notNull()
      .references(() => inventorySyncBatch.id, { onDelete: 'cascade' }),
    rowIndex: bigint('row_index', { mode: 'number' }).notNull(),
    // Источник истины — `InventorySyncRowError['errorCode']` (см. JSDoc выше).
    errorCode: varchar('error_code', { length: 32 }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Hot-path кабинета аптеки: «список ошибок батча N, по порядку строк».
    index('ix_inventory_sync_errors_batch').on(table.batchId, table.rowIndex),
    check(
      'chk_inventory_sync_errors_error_code',
      sql`${table.errorCode} IN (
        'invalid_price',
        'invalid_quantity',
        'expires_at_invalid',
        'barcode_invalid',
        'medicine_not_found',
        'unmatched_medicine',
        'duplicate_in_batch',
        'ambiguous_date_format',
        'missing_required_field'
      )`,
    ),
  ],
)

export type InventorySyncErrorRow = typeof inventorySyncErrors.$inferSelect
export type InventorySyncErrorInsert = typeof inventorySyncErrors.$inferInsert
