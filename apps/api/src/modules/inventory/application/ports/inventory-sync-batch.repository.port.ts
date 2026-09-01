/**
 * Порт `InventorySyncBatchRepository` (EP-05, DTJ-144, DTJ-148) — аудит-лог
 * синхронизаций + хранилище состояния FSM.
 *
 * R1-бутстрап (DTJ-140+): плоский `create` + `markStatus` для совместимости
 * с `IngestInventoryBatchUseCase` (старый, плоский путь).
 *
 * R1-полный (DTJ-148): `findById` + `save` для работы с
 * `InventorySyncBatch`-агрегатом (FSM через `markProcessing` /
 * `markCompletedFullSuccess` / `markCompletedPartialSuccess` /
 * `markFailedValidation`).
 *
 * Реализации:
 *   - InMemory (R1-бутстрап) — `in-memory-inventory-sync-batch.repository.ts`.
 *   - Drizzle (DTJ-154) — set-based `INSERT ... ON CONFLICT (id) DO UPDATE`.
 */
import type { InventorySyncBatch } from '../../domain/inventory-sync-batch.entity.js'
import type {
  InventorySyncChannel,
  InventorySyncStatus,
} from '../../domain/inventory-sync.types.js'

export const INVENTORY_SYNC_BATCH_REPOSITORY = Symbol.for(
  '@dorutj/inventory/inventory-sync-batch-repository',
)

/** Устаревший «плоский» вход для совместимости с IngestInventoryBatchUseCase (R1-бутстрап). */
export interface CreateInventorySyncBatchInput {
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly totalRows: number
  readonly acceptedRows: number
  readonly rejectedRows: number
  readonly errorSummary: unknown
  readonly note: string | null
}

/** Одна запись построчной ошибки (для `inventory_sync_errors` таблицы, DTJ-145). */
export interface InventorySyncRowError {
  readonly batchId: string
  readonly rowIndex: number
  readonly errorCode:
    | 'invalid_price'
    | 'invalid_quantity'
    | 'expires_at_invalid'
    | 'barcode_invalid'
    | 'medicine_not_found'
    | 'unmatched_medicine'
    | 'duplicate_in_batch'
  readonly reason: string
}

/** Сырая строка из `inventory_sync_raw_items` (DTJ-141, DTJ-145). */
export interface RawInventoryRow {
  readonly rowIndex: number
  readonly payload: Readonly<Record<string, unknown>>
}

/** Неполная full-sync сессия (DTJ-152, watchdog). */
export interface IncompleteFullSyncSession {
  readonly fullSyncSessionId: string
  readonly pharmacyId: string
  /** Момент получения ПОСЛЕДНЕЙ страницы этой сессии (не начала). */
  readonly lastPageReceivedAt: Date
}

export interface InventorySyncBatchRepository {
  /** УСТАРЕЛО (R1-бутстрап): плоский `create` + `markStatus`. */
  create(input: CreateInventorySyncBatchInput): Promise<{ readonly id: string }>
  markStatus(id: string, status: InventorySyncStatus): Promise<void>

  /** R1-полный: загрузить агрегат по ID (для FSM-переходов в use case). */
  findById(id: string): Promise<InventorySyncBatch | null>

  /** R1-полный: сохранить агрегат (новые счётчики, статус, completedAt). */
  save(batch: InventorySyncBatch): Promise<void>

  /**
   * R1-полный: записать построчные ошибки в `inventory_sync_errors`
   * (DTJ-145, отдельная таблица, не в `inventory_sync_batch.error_summary`).
   * Батчевый INSERT, ВНУТРИ `unitOfWork.run(...)` (правило `02` §3).
   */
  appendErrors(errors: readonly InventorySyncRowError[]): Promise<void>

  /**
   * R1-полный: прочитать сырые строки из `inventory_sync_raw_items`
   * (для воркера, который загружает payload пачки и прогоняет через
   * matcher). Используется, когда вызов идёт из BullMQ worker'а
   * (DTJ-154), а не из контроллера.
   */
  findRawItems(batchId: string): Promise<readonly RawInventoryRow[]>

  /**
   * R1-полный: найти `full-sync` сессии, чья последняя страница
   * (`is_last_page=true`) НЕ получена и `MAX(received_at) <
   * now() - interval :olderThanMinutes` (DTJ-152, SRS-INV-061).
   * Реализация: `SELECT full_sync_session_id, pharmacy_id,
   * MAX(received_at) FROM inventory_sync_batches WHERE sync_type='full'
   * AND full_sync_session_id IS NOT NULL GROUP BY ... HAVING
   * bool_and(is_last_page)=false AND MAX(received_at) < cutoff`.
   */
  findIncompleteFullSyncSessions(
    olderThanMinutes: number,
  ): Promise<readonly IncompleteFullSyncSession[]>

  /**
   * Идемпотентное создание батча (DTJ-157, SRS-INV-009): если батч с
   * `id=:batchId` уже существует — НЕ создавать новый, вернуть
   * существующий + `created=false`. Реализация:
   * `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING *` + fallback
   * `SELECT` при пустом `RETURNING`. Тело НЕ сверяется побайтово —
   * `batch_id` это строго UUIDv7 клиента.
   */
  createIfNotExists(input: {
    readonly id: string
    readonly pharmacyId: string
    readonly channel: InventorySyncChannel
    readonly syncType: 'delta' | 'full'
    readonly fullSyncSessionId: string | null
    readonly isLastPage: boolean
    readonly totalRows: number
    readonly note: string | null
    readonly now: Date
  }): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }>

  /**
   * Баtчевый INSERT в `inventory_sync_raw_items` (DTJ-145/157). Вызывается
   * в той же `unitOfWork.run(...)` что `createIfNotExists` + публикация
   * outbox-события (SRS-INV-055 — атомарность гарантирована БД).
   */
  appendRawItems(
    batchId: string,
    items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void>
}
