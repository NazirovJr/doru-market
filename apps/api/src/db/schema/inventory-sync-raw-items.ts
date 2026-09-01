/**
 * Drizzle-схема `inventory_sync_raw_items` (EP-05, DTJ-142, SRS-INV-027/028).
 *
 * Промежуточное хранилище payload строк пачки синхронизации ДО матчинга.
 * Воркер (DTJ-154) читает отсюда сырые данные, прогоняет через
 * `CompositeInventoryMatcherService` (DTJ-146/147) и обновляет
 * `pharmacy_inventory` (успех) или `catalog_match_queue` (нерезолв).
 *
 * Зачем отдельная таблица (а не класть payload в `inventory_sync_batch.error_summary`):
 *   1. Атомарность — если payload большой (до 1000 строк на пачку, см.
 *      `chk_sync_batches_row_limit`), JSONB на каждую пачку создаёт
 *      большие btree-обновления.
 *   2. Параллельная обработка страниц full-снапшота — несколько воркеров
 *      могут независимо читать СВОЮ порцию raw_items по `batch_id`,
 *      не блокируя друг друга на общем JSONB.
 *   3. `ON DELETE CASCADE` от batch — удаление batch'а забирает сырые
 *      данные автоматически, не оставляет orphan-строк.
 *
 * `payload` хранит JSONB-форму `InventoryBatchUpsertRow` (DTJ-145) ДО
 * матчинга: сырой barcode (строка как прислали, без нормализации), сырое
 * торговое название, сырая форма/дозировка/производитель. Воркер сам
 * решает, что с этим делать.
 */
import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { inventorySyncBatch } from './inventory-sync-batch.js'

export const INVENTORY_SYNC_RAW_ITEMS_TABLE = 'inventory_sync_raw_items'

// Drizzle ORM 0.45: третий параметр pgTable принимает объект; миграция на новый
// массив — в Drizzle 1.0. До апгрейда оставляем объект, типизация не ломается.
export const inventorySyncRawItems = pgTable(
  INVENTORY_SYNC_RAW_ITEMS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK на batch с CASCADE — при удалении batch'а (DTJ-152 watchdog
    // чистит зависшие full-sync сессии) сырые данные забираются автоматически.
    batchId: uuid('batch_id')
      .notNull()
      .references(() => inventorySyncBatch.id, { onDelete: 'cascade' }),
    // Сырой payload — JSONB-форма `InventoryBatchUpsertRow` (DTJ-145).
    // НЕ валидируется на уровне БД (БД-уровневая проверка избыточна:
    // контракт `InventoryBatchUpsertRow.parse` гарантирует форму до записи).
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Hot-path: воркер фильтрует `WHERE batch_id = $1 ORDER BY id`.
    // Позиция внутри пачки хранится в `payload.rowIndex` (DTJ-145),
    // а не в отдельной колонке — упрощение для R1.
    index('ix_inventory_sync_raw_items_batch').on(table.batchId, table.id),
  ],
)

export type InventorySyncRawItemRow = typeof inventorySyncRawItems.$inferSelect
export type InventorySyncRawItemInsert = typeof inventorySyncRawItems.$inferInsert
