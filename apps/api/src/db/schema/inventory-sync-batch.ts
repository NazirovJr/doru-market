/**
 * Drizzle-схема `inventory_sync_batch` (EP-05, DTJ-144, DTJ-142). Аудит-лог
 * принятых синхронизаций остатков. State machine:
 * `received` → `processing` → (`completed`|`failed`).
 *
 * Хранит:
 *   - `pharmacy_id` — кто прислал.
 *   - `channel` — откуда: `manual` (UI), `excel` (Excel/CSV upload), `rest` (1С/ERP API).
 *   - `sync_type` — `delta` (upsert конкретных партий) или `full` (полный
 *     снапшот остатков с пагинацией, см. `full_sync_session_id`/`page_number`).
 *   - `total_rows` / `accepted_rows` / `rejected_rows` — счётчики.
 *   - `received_at` / `finished_at` — тайминги.
 *   - `error_summary` JSONB — при `failed`: какие строки отклонены и почему (SRS-INV-011).
 *   - `full_sync_session_id` / `page_number` / `is_last_page` — пагинация
 *     полного снапшота (EP-05, DTJ-142, SRS-INV-027). `page_number` ≥ 1,
 *     `is_last_page` = `true` на последней странице сессии.
 *   - `source_upload_id` — UUID аплоада (для Excel-канала — `S3`-ключ или
 *     аналог; для `rest` — внешний request-id; nullable, т.к. `manual`-канал
 *     не имеет отдельного источника).
 *
 * Это ЛОГ, а не источник правды. Детальный успех/неуспех по строке —
 * через outbox `inventory_outbox` (DTJ-153, не в этом тикете).
 */
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { pharmacies } from './pharmacies.js'

export const INVENTORY_SYNC_BATCH_TABLE = 'inventory_sync_batch'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const inventorySyncBatch = pgTable(
  INVENTORY_SYNC_BATCH_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 16 }).notNull(),
    syncType: varchar('sync_type', { length: 8 }).notNull().default('delta'),
    // `status` — `varchar(32)` со списком TS-литералов. Полный набор
    // значений — `apps/api/src/modules/inventory/domain/inventory-sync-batch.entity.ts`
    // (FSM, SRS-DOM-145..150). CHECK-constraint `chk_inventory_sync_batch_status`
    // (миграция 0012) ограничивает значения на стороне Postgres.
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    totalRows: integer('total_rows').notNull().default(0),
    acceptedRows: integer('accepted_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    errorSummary: jsonb('error_summary'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    note: text('note'),
    // DTJ-142: пагинация full-снапшота. `full_sync_session_id` объединяет
    // ВСЕ страницы одной full-сессии; заполняется ТОЛЬКО для `sync_type='full'`
    // (CHECK `chk_sync_batches_session_only_for_full`, см. constraints ниже).
    fullSyncSessionId: uuid('full_sync_session_id'),
    pageNumber: integer('page_number').notNull().default(1),
    isLastPage: boolean('is_last_page').notNull().default(true),
    sourceUploadId: uuid('source_upload_id'),
  },
  (table) => ({
    byPharmacyIdx: index('ix_inventory_sync_batch_pharmacy').on(
      table.pharmacyId,
      table.receivedAt,
    ),
    byStatusIdx: index('ix_inventory_sync_batch_status').on(table.status, table.receivedAt),
    // DTJ-142: индекс для запросов всех страниц одной full-сессии
    // (SRS-INV-027 — пагинация, обработка watchdog'ом `151`).
    bySessionIdx: index('ix_inventory_sync_batch_session').on(
      table.fullSyncSessionId,
      table.pageNumber,
    ),
    // CHECK: channel ∈ {'manual','excel','rest'}, status ∈ {'received','processing','completed','failed'}.
    channelCheck: check(
      'chk_inventory_sync_batch_channel',
      sql`${table.channel} IN ('manual','excel','rest')`,
    ),
    statusCheck: check(
      'chk_inventory_sync_batch_status',
      sql`${table.status} IN ('received','processing','completed','failed')`,
    ),
    // DTJ-142, SRS-INV-005: `full_sync_session_id` заполняется ТОЛЬКО для
    // full-синхронизаций. Delta-пакеты это поле НЕ заполняют (для них пагинация
    // неприменима — это upsert конкретных партий, не полный снапшот).
    sessionOnlyForFullCheck: check(
      'chk_sync_batches_session_only_for_full',
      sql`(${table.syncType} = 'full' AND ${table.fullSyncSessionId} IS NOT NULL) OR (${table.syncType} = 'delta' AND ${table.fullSyncSessionId} IS NULL)`,
    ),
    pageNumberPositiveCheck: check('chk_sync_batches_page_number_positive', sql`${table.pageNumber} >= 1`),
  }),
)

export type InventorySyncBatchRow = typeof inventorySyncBatch.$inferSelect
export type InventorySyncBatchInsert = typeof inventorySyncBatch.$inferInsert
