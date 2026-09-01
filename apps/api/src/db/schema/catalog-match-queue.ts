/**
 * Drizzle-схема `catalog_match_queue` (EP-05, DTJ-142, п.3; EP-moderation
 * ещё не начат к моменту DTJ-142 — см. README EP-05 §«Кросс-эпиковые
 * зависимости»).
 *
 * Промежуточная очередь нерезолвленных строк inventory-синхронизации, для
 * которых `CompositeInventoryMatcherService` (DTJ-146/147) НЕ смог однозначно
 * сопоставить вход с каталогом `medicines` (EP-04). `moderation`-эпик
 * (точная нумерация — вне R1) берёт эту таблицу под полное владение:
 * курация, ретроактивное применение резолюции, UI оператора.
 *
 * Сейчас таблица СОЗДАНА инвентарным эпиком, потому что
 * `IngestInventoryBatchUseCase` (DTJ-148) пишет в неё построчно, и без
 * таблицы физически невозможно выполнить SRS-INV-028 «при нерезолве —
 * поставить в очередь модерации». Если `moderation`-эпик к моменту
 * своей приёмки уже обнаружит созданную таблицу — `CREATE TABLE` из его
 * стороны не нужен, он лишь ДОПОЛНЯЕТ (поля для UI/аудита).
 *
 * **Координационная заметка для moderation-эпика (владельцу файла при
 * интеграции):** не удалять `pharmacy_id` / `raw_*` / `source_batch_id` /
 * `source_sync_timestamp` — это контракт inventory-эпика (DTJ-142, п.3).
 * Допустимо добавлять новые колонки, индексы, CHECK'и. FK на `medicines`
 * остаётся `ON DELETE SET NULL` (резолюция оператора может снять связь
 * с каталогом, не удаляя запись очереди).
 */
import { sql } from 'drizzle-orm'
import { date, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { medicines } from './medicines.js'
import { inventorySyncBatch } from './inventory-sync-batch.js'
import { pharmacies } from './pharmacies.js'

export const CATALOG_MATCH_QUEUE_TABLE = 'catalog_match_queue'

/**
 * Статус записи в очереди. На этом шаге (EP-05) воркер ставит ТОЛЬКО
 * `'pending'` (SRS-INV-028). `'resolved'` / `'rejected'` — пишет
 * moderation-эпик через UI оператора.
 *
 * Объявляем через `varchar` (а не отдельный enum), потому что
 * `moderation`-эпик может расширить набор значений; CHECK ограничивает
 * известные значения и легко дополняется через отдельную миграцию
 * (без блокировки, как `ALTER TYPE` enum).
 */
export type CatalogMatchQueueStatus = 'pending' | 'resolved' | 'rejected'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const catalogMatchQueue = pgTable(
  CATALOG_MATCH_QUEUE_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    // Опциональный FK на каталог: воркер может записать запись с
    // `medicineId = NULL` (нерезолв — кандидат не найден) и тогда
    // moderation-эпик разрешает её вручную. `ON DELETE SET NULL` —
    // при удалении medicine запись остаётся в очереди, но FK снимается
    // (нельзя удалять catalog, пока на него висят нерезолвленные очереди).
    medicineId: uuid('medicine_id').references(() => medicines.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    // Сырые данные строки inventory — для отображения оператору в UI
    // moderation и для повторного матчинга при изменении каталога
    // (DTJ-149, `ResolveCatalogMatchQueueItemUseCase`).
    rawBarcode: varchar('raw_barcode', { length: 64 }),
    rawTradeName: varchar('raw_trade_name', { length: 255 }).notNull(),
    rawDosageForm: varchar('raw_dosage_form', { length: 64 }),
    rawDosageStrength: varchar('raw_dosage_strength', { length: 64 }),
    rawManufacturerName: varchar('raw_manufacturer_name', { length: 255 }),
    // DTJ-142, п.3: 5 колонок, специфичных для inventory-канала.
    rawStockQuantity: integer('raw_stock_quantity'),
    rawExpiryDate: date('raw_expiry_date'),
    rawBatchNumber: varchar('raw_batch_number', { length: 100 }),
    sourceBatchId: uuid('source_batch_id').references(() => inventorySyncBatch.id, {
      onDelete: 'set null',
    }),
    sourceSyncTimestamp: timestamp('source_sync_timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Hot-path: модератор открывает «список pending» — фильтр
    // `status = 'pending' ORDER BY created_at`.
    byStatusIdx: index('ix_catalog_match_queue_status').on(table.status, table.createdAt),
    // Для повторного матчинга: запрос всех нерезолвов конкретной аптеки
    // (SRS-INV-034 — «отчёт об ошибках для аптеки»).
    byPharmacyIdx: index('ix_catalog_match_queue_pharmacy').on(table.pharmacyId),
  }),
)

export type CatalogMatchQueueRow = typeof catalogMatchQueue.$inferSelect
export type CatalogMatchQueueInsert = typeof catalogMatchQueue.$inferInsert
