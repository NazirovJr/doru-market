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
import type {
  InventorySyncBatch,
  InventorySyncBatchSnapshot,
} from '../../domain/inventory-sync-batch.entity.js'
import type {
  InventorySyncChannel,
  InventorySyncStatus,
} from '../../domain/inventory-sync.types.js'
// `UnitOfWorkTx` — через публичный фасад модуля `auth` (D-27, `no-cross-module-deep-import`):
// inventory не имеет собственного UoW-порта, использует чужой через фасад (см. use case JSDoc).
import type { UnitOfWorkTx } from '@/modules/auth/index.js'

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

/**
 * Коды построчных ошибок (`inventory_sync_errors.error_code`, CHECK-constraint, НЕ pg enum —
 * см. JSDoc миграции 0020/0044). `ambiguous_date_format`/`missing_required_field` — DTJ-160
 * (Excel/CSV-парсер, SRS-INV-013), остальные — DTJ-145/148 (REST/матчинг-конвейер).
 */
export type InventorySyncRowErrorCode =
  | 'invalid_price'
  | 'invalid_quantity'
  | 'expires_at_invalid'
  | 'barcode_invalid'
  | 'medicine_not_found'
  | 'unmatched_medicine'
  | 'duplicate_in_batch'
  | 'ambiguous_date_format'
  | 'missing_required_field'

/** Одна запись построчной ошибки (для `inventory_sync_errors` таблицы, DTJ-145). */
export interface InventorySyncRowError {
  readonly batchId: string
  readonly rowIndex: number
  readonly errorCode: InventorySyncRowErrorCode
  readonly reason: string
}

/**
 * Построчная ошибка + исходные данные строки (DTJ-163/164). `rawRow` реконструируется JOIN'ом
 * с `inventory_sync_raw_items` по `(batch_id, row_index)` — отдельной колонки в
 * `inventory_sync_errors` для этого НЕТ (см. риски DTJ-164: raw_items уже хранит payload для
 * ЛЮБОГО батча, включая синтетический parser-errors контейнер DTJ-161/164, повторное поле было
 * бы дублированием источника данных). `null`, если raw-строка не найдена (не должно происходить
 * в норме — раз ошибка есть, строка была персистирована; `null` — defensive, не падение).
 */
export interface InventoryRowErrorDetail {
  readonly rowIndex: number
  readonly errorCode: InventorySyncRowErrorCode
  readonly reason: string
  readonly rawRow: Readonly<Record<string, unknown>> | null
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

  /**
   * R1-полный: загрузить агрегат по ID (для FSM-переходов в use case).
   *
   * `tx?` (волна 6, self-deadlock пула соединений, тот же дефект, что чинили
   * в checkout DTJ-231/233): `IngestInventoryBatchWithMatchingUseCase.execute`
   * вызывает `findById`/`save`/`appendErrors` ВНУТРИ `uow.run(tx => ...)` —
   * без `tx` каждый метод просил бы у пула ВТОРОЕ соединение поверх уже
   * удержанного, при конкурентности ≥ размера пула тупик навсегда (см. JSDoc
   * use case'а).
   */
  findById(id: string, tx?: UnitOfWorkTx): Promise<InventorySyncBatch | null>

  /** R1-полный: сохранить агрегат (новые счётчики, статус, completedAt). `tx?` — см. `findById`. */
  save(batch: InventorySyncBatch, tx?: UnitOfWorkTx): Promise<void>

  /**
   * R1-полный: записать построчные ошибки в `inventory_sync_errors`
   * (DTJ-145, отдельная таблица, не в `inventory_sync_batch.error_summary`).
   * Батчевый INSERT, ВНУТРИ `unitOfWork.run(...)` (правило `02` §3). `tx?` — см. `findById`.
   */
  appendErrors(errors: readonly InventorySyncRowError[], tx?: UnitOfWorkTx): Promise<void>

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
    /**
     * Группирующий UUID загрузки (DTJ-161, SRS-INV-014/043) — для Excel-канала объединяет N
     * чанков ОДНОЙ загрузки под одним `sourceUploadId` (переиспользуется и для delta, и для full).
     * `null` для каналов без группировки (`rest`/`manual`). Колонка `source_upload_id` уже
     * существует в БД с DTJ-142 (`0015a_inventory_sync_extensions.sql`) — этот тикет лишь
     * прокидывает её через порт/агрегат, которые её раньше не читали/не писали.
     */
    readonly sourceUploadId?: string | null
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

  /**
   * Узкий lookup `pharmacies.chain_id` по `pharmacyId` (DTJ-158/163/164) — для проверки владения
   * «свой батч ИЛИ батч своей сети» (SRS-API-046-style: чужой → 404, не 403). Не толще, чем нужно
   * потребителю: только `chain_id`, не вся строка `pharmacies`. `null`, если аптека вне сети ИЛИ
   * не существует (оба случая трактуются одинаково вызывающей стороной — отсутствие сети).
   */
  findPharmacyChainId(pharmacyId: string): Promise<string | null>

  /**
   * Курсорный список батчей для отчёта кабинета (DTJ-163, SRS-INV-043, SRS-API-004). Скоуп —
   * РЕШЕНИЕ ВЫЗЫВАЮЩЕЙ СТОРОНЫ (application/presentation, не порт): передать `pharmacyId` (одна
   * аптека) ИЛИ `chainId` (вся сеть) ИЛИ ни то, ни другое (`super_admin`, без фильтра). Если оба
   * заданы — `chainId` в приоритете (шире скоуп). Сортировка — `receivedAt DESC, id DESC`
   * (keyset). Синтетические parser-errors контейнеры (DTJ-164, `total_rows=0`) ВСЕГДА исключены
   * из этого списка — см. риски DTJ-164 (не путать пользователя строкой «0 из 0»).
   */
  findManyForReport(input: {
    readonly pharmacyId: string | null
    readonly chainId: string | null
    readonly cursor: { readonly v: string; readonly id: string } | null
    readonly limit: number
  }): Promise<{ readonly items: readonly InventorySyncBatchSnapshot[]; readonly hasMore: boolean }>

  /**
   * Построчные ошибки батча + исходные данные строки (DTJ-163 `/errors`, DTJ-162 ответ ручного
   * ввода) — JOIN с `inventory_sync_raw_items` по `(batch_id, row_index)`, см. JSDoc
   * `InventoryRowErrorDetail`. Порядок — по `rowIndex` (та же индексация `ix_inventory_sync_errors_batch`).
   */
  findRowErrorsByBatchId(batchId: string): Promise<readonly InventoryRowErrorDetail[]>

  /**
   * Все батчи одной загрузки (DTJ-164, `source_upload_id` — группирует N чанков Excel-импорта,
   * ВКЛЮЧАЯ синтетический parser-errors контейнер DTJ-161/164, в отличие от `findManyForReport`).
   */
  findBySourceUploadId(sourceUploadId: string): Promise<readonly InventorySyncBatchSnapshot[]>
}
