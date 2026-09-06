/**
 * Drizzle-реализация `InventorySyncBatchRepository` (EP-05, DTJ-144/148/154,
 * волна 5 блок C — персистентность модуля inventory).
 *
 * Реализует ОБА API порта:
 *   - Плоский `create`/`markStatus` (R1-бутстрап, `IngestInventoryBatchUseCase`,
 *     легаси — на текущий момент контроллер (`InventoryBatchUpdateController`)
 *     вызывает ТОЛЬКО `IngestInventoryBatchWithMatchingUseCase`, этот путь
 *     не задействован боевым HTTP-маршрутом, но остаётся частью контракта
 *     порта — не удаляется молча, см. отчёт сдачи, «Найденные чужие проблемы»).
 *   - Агрегатный `findById`/`save`/`createIfNotExists`/`appendRawItems`/
 *     `findRawItems`/`findIncompleteFullSyncSessions` (R1-полный, FSM,
 *     `IngestInventoryBatchWithMatchingUseCase` + `DetectStuckFullSyncSessionsUseCase`).
 *
 * `appendErrors` ДЕЛЕГИРУЕТ в `DrizzleInventorySyncErrorsRepository`
 * (DTJ-145) — не второй способ писать `inventory_sync_errors`, а ИМЕННО тот
 * класс, чей JSDoc явно резервировал этот путь: «TODO(DTJ-154): включить
 * этот класс как часть полной Drizzle-реализации `InventorySyncBatchRepository`».
 *
 * `inventory_sync_raw_items.row_index` — реальная колонка (см. ИСПРАВЛЕНО в
 * `db/schema/inventory-sync-raw-items.ts`: схема раньше утверждала обратное
 * и была не синхронизирована с фактически применённой миграцией — найдено
 * интеграционным тестом против реального Postgres).
 *
 * `findIncompleteFullSyncSessions` — `GROUP BY ... HAVING bool_and(...)`,
 * недоступно через query-builder Drizzle без утяжеления; сырой SQL через
 * `db.execute(sql\`...\`)`, тот же приём, что `postgres-pharmacy-map.adapter.ts`
 * (`extractRows` нормализация результата).
 *
 * DI: `@Inject(DRIZZLE_DB)` + `@Inject(DrizzleInventorySyncErrorsRepository)`
 * явные (esbuild/vitest не эмитит `design:paramtypes`, DTJ-001).
 *
 * `findById`/`save`/`appendErrors` принимают ОПЦИОНАЛЬНЫЙ `tx` (волна 6,
 * self-deadlock пула соединений, тот же дефект, что чинили в checkout
 * DTJ-231/233) — используют его через `resolveDrizzleClient`, чтобы FSM-
 * персистенция батча была частью ТОЙ ЖЕ транзакции, что и
 * `IngestInventoryBatchWithMatchingUseCase.execute` (см. её JSDoc). Плоский
 * API (`create`/`markStatus`) и `findRawItems`/`createIfNotExists`/
 * `appendRawItems`/`findIncompleteFullSyncSessions` — `tx` не принимают, не
 * вызываются ЭТИМ use case'ом изнутри `uow.run`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { asc, eq, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { inventorySyncBatch, type InventorySyncBatchRow } from '@/db/schema/inventory-sync-batch.js'
import { inventorySyncRawItems } from '@/db/schema/inventory-sync-raw-items.js'
import {
  InventorySyncBatch,
  type BatchStatus,
  type InventorySyncBatchSnapshot,
} from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type { InventorySyncChannel, InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type CreateInventorySyncBatchInput,
  type IncompleteFullSyncSession,
  type InventorySyncBatchRepository,
  type InventorySyncRowError,
  type RawInventoryRow,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import type { UnitOfWorkTx } from '@/modules/auth/index.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'
import { DrizzleInventorySyncErrorsRepository } from './drizzle-inventory-sync-errors.repository.js'
import {
  DrizzleInventorySyncReportRepository,
  type ReportScopeInput,
} from './drizzle-inventory-sync-report.repository.js'
import { rowToInventorySyncBatchSnapshot } from './inventory-sync-batch-row.mapper.js'
import type { InventoryRowErrorDetail } from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'

const MS_PER_MINUTE = 60_000
const NON_TERMINAL_STATUSES: ReadonlySet<InventorySyncStatus> = new Set(['queued', 'processing'])

interface CreateIfNotExistsInput {
  readonly id: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: 'delta' | 'full'
  readonly fullSyncSessionId: string | null
  readonly isLastPage: boolean
  readonly totalRows: number
  readonly note: string | null
  readonly now: Date
  readonly sourceUploadId?: string | null
}

@Injectable()
export class DrizzleInventorySyncBatchRepository implements InventorySyncBatchRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(DrizzleInventorySyncErrorsRepository)
    private readonly errorsRepository: DrizzleInventorySyncErrorsRepository,
    // Опционален с фолбэком (не `@Inject`-обязателен): 2 существующих интеграционных теста
    // (DTJ-144/154) конструируют этот класс напрямую с ДВУМЯ аргументами — не трогаем их вызовы.
    // NestJS DI при боевой сборке всегда резолвит все 3 явно (см. `inventory.module.ts`), фолбэк
    // ниже срабатывает ТОЛЬКО при ручном `new` без 3-го аргумента.
    @Inject(DrizzleInventorySyncReportRepository)
    private readonly reportRepository: DrizzleInventorySyncReportRepository = new DrizzleInventorySyncReportRepository(
      db,
    ),
  ) {}

  // ── Делегирование в DrizzleInventorySyncReportRepository (DTJ-163/164) ────

  findPharmacyChainId(pharmacyId: string): Promise<string | null> {
    return this.reportRepository.findPharmacyChainId(pharmacyId)
  }

  findManyForReport(
    input: ReportScopeInput,
  ): Promise<{ readonly items: readonly InventorySyncBatchSnapshot[]; readonly hasMore: boolean }> {
    return this.reportRepository.findManyForReport(input)
  }

  findRowErrorsByBatchId(batchId: string): Promise<readonly InventoryRowErrorDetail[]> {
    return this.reportRepository.findRowErrorsByBatchId(batchId)
  }

  findBySourceUploadId(sourceUploadId: string): Promise<readonly InventorySyncBatchSnapshot[]> {
    return this.reportRepository.findBySourceUploadId(sourceUploadId)
  }

  // ── Плоский API (R1-бутстрап, `IngestInventoryBatchUseCase`, легаси) ──────

  async create(input: CreateInventorySyncBatchInput): Promise<{ readonly id: string }> {
    const now = new Date()
    // Флоский путь синхронный и одношаговый — нет отдельной фазы `processing`
    // (в отличие от FSM-агрегата ниже). Терминальный статус выставляется сразу.
    const status: BatchStatus = input.rejectedRows > 0 ? 'failed_validation' : 'completed_full_success'
    const rows = await this.db
      .insert(inventorySyncBatch)
      .values({
        pharmacyId: input.pharmacyId,
        channel: input.channel,
        totalRows: input.totalRows,
        acceptedRows: input.acceptedRows,
        rejectedRows: input.rejectedRows,
        errorSummary: input.errorSummary,
        note: input.note,
        status,
        receivedAt: now,
        finishedAt: now,
      })
      .returning({ id: inventorySyncBatch.id })
    const row = rows[0]
    if (row === undefined) {
      throw new Error('DrizzleInventorySyncBatchRepository.create: INSERT returned no row')
    }
    return { id: row.id }
  }

  async markStatus(id: string, status: InventorySyncStatus): Promise<void> {
    const isTerminal = !NON_TERMINAL_STATUSES.has(status)
    await this.db
      .update(inventorySyncBatch)
      .set({
        status,
        ...(isTerminal ? { finishedAt: new Date() } : {}),
      })
      .where(eq(inventorySyncBatch.id, id))
  }

  // ── Агрегатный API (R1-полный, FSM) ────────────────────────────────────

  async findById(id: string, tx?: UnitOfWorkTx): Promise<InventorySyncBatch | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(inventorySyncBatch).where(eq(inventorySyncBatch.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return InventorySyncBatch.restore(rowToInventorySyncBatchSnapshot(row))
  }

  async save(batch: InventorySyncBatch, tx?: UnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const snapshot = batch.toSnapshot()
    await client
      .update(inventorySyncBatch)
      .set({
        status: snapshot.status,
        acceptedRows: snapshot.acceptedRows,
        rejectedRows: snapshot.rejectedRows,
        errorSummary: snapshot.errorSummary,
        finishedAt: snapshot.completedAt,
      })
      .where(eq(inventorySyncBatch.id, snapshot.id))
  }

  /** Делегирует в `DrizzleInventorySyncErrorsRepository` (DTJ-145) — см. JSDoc файла. `tx?` — см. `findById`. */
  async appendErrors(errors: readonly InventorySyncRowError[], tx?: UnitOfWorkTx): Promise<void> {
    await this.errorsRepository.appendErrors(errors, tx)
  }

  async findRawItems(batchId: string): Promise<readonly RawInventoryRow[]> {
    const rows = await this.db
      .select({ rowIndex: inventorySyncRawItems.rowIndex, payload: inventorySyncRawItems.payload })
      .from(inventorySyncRawItems)
      .where(eq(inventorySyncRawItems.batchId, batchId))
      .orderBy(asc(inventorySyncRawItems.rowIndex))
    return rows.map((row) => ({
      rowIndex: row.rowIndex,
      payload: row.payload as Readonly<Record<string, unknown>>,
    }))
  }

  /**
   * Валидация ЧЕРЕЗ доменную фабрику `InventorySyncBatch.create(...)` ДО
   * `INSERT` (не после) — тот же порядок, что `InMemoryInventorySyncBatchRepository`:
   * домен остаётся источником правды за инвариантами (пагинация,
   * `fullSyncSessionId` XOR `syncType`), а не CHECK-constraint Postgres
   * (правило `02` §5 — направление зависимостей, домен не следует за БД).
   * Разбит на три приватных шага (`max-lines-per-function` C1: ≤40 строк).
   */
  async createIfNotExists(
    input: CreateIfNotExistsInput,
  ): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    const snapshot = this.buildCandidateSnapshot(input)
    const insertedRow = await this.insertBatchIfAbsent(snapshot)
    if (insertedRow !== null) {
      return { batch: InventorySyncBatch.restore(rowToInventorySyncBatchSnapshot(insertedRow)), created: true }
    }
    // Конфликт по `id` (batch_id уже принят ранее, SRS-INV-009) — идемпотентный
    // повтор, возвращаем СУЩЕСТВУЮЩУЮ строку, новую не создаём.
    const existingRow = await this.fetchExistingBatchRow(input.id)
    return { batch: InventorySyncBatch.restore(rowToInventorySyncBatchSnapshot(existingRow)), created: false }
  }

  private buildCandidateSnapshot(input: CreateIfNotExistsInput): InventorySyncBatchSnapshot {
    const candidate = InventorySyncBatch.create(
      {
        id: input.id,
        pharmacyId: input.pharmacyId,
        channel: input.channel,
        syncType: input.syncType,
        totalRows: input.totalRows,
        ...(input.fullSyncSessionId !== null ? { fullSyncSessionId: input.fullSyncSessionId } : {}),
        ...(input.syncType === 'full' ? { isLastPage: input.isLastPage } : {}),
        ...(input.sourceUploadId !== null && input.sourceUploadId !== undefined
          ? { sourceUploadId: input.sourceUploadId }
          : {}),
      },
      input.now,
      input.note,
    )
    return candidate.toSnapshot()
  }

  /** `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING *` — `null`, если конфликт. */
  private async insertBatchIfAbsent(snapshot: InventorySyncBatchSnapshot): Promise<InventorySyncBatchRow | null> {
    const inserted = await this.db
      .insert(inventorySyncBatch)
      .values({
        id: snapshot.id,
        pharmacyId: snapshot.pharmacyId,
        channel: snapshot.channel,
        syncType: snapshot.syncType,
        fullSyncSessionId: snapshot.fullSyncSessionId,
        pageNumber: snapshot.pageNumber,
        isLastPage: snapshot.isLastPage,
        totalRows: snapshot.totalRows,
        note: snapshot.note,
        receivedAt: snapshot.receivedAt,
        status: snapshot.status,
        sourceUploadId: snapshot.sourceUploadId ?? null,
      })
      .onConflictDoNothing({ target: inventorySyncBatch.id })
      .returning()
    return inserted[0] ?? null
  }

  private async fetchExistingBatchRow(id: string): Promise<InventorySyncBatchRow> {
    const rows = await this.db.select().from(inventorySyncBatch).where(eq(inventorySyncBatch.id, id)).limit(1)
    const existing = rows[0]
    if (existing === undefined) {
      throw new Error(`createIfNotExists: race — batch ${id} vanished between INSERT ON CONFLICT and fallback SELECT`)
    }
    return existing
  }

  async appendRawItems(
    batchId: string,
    items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void> {
    if (items.length === 0) return
    await this.db.insert(inventorySyncRawItems).values(
      items.map((item) => ({
        batchId,
        rowIndex: item.rowIndex,
        payload: item.payload,
      })),
    )
  }

  /**
   * `bool_and(is_last_page)=false` — ни одна страница сессии ещё не помечена
   * последней. Группировка по ВСЕМ страницам (delta-батчи сюда не попадают
   * — `sync_type='full' AND full_sync_session_id IS NOT NULL`). `HAVING
   * bool_and(...)` недоступно через query-builder Drizzle без утяжеления —
   * сырой SQL, тот же приём, что `postgres-pharmacy-map.adapter.ts`
   * (`extractSessionRows` нормализация результата).
   */
  async findIncompleteFullSyncSessions(olderThanMinutes: number): Promise<readonly IncompleteFullSyncSession[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * MS_PER_MINUTE)
    const result = await this.db.execute(sql`
      SELECT full_sync_session_id AS "fullSyncSessionId",
             pharmacy_id AS "pharmacyId",
             MAX(received_at) AS "lastPageReceivedAt"
      FROM inventory_sync_batch
      WHERE sync_type = 'full' AND full_sync_session_id IS NOT NULL
      GROUP BY full_sync_session_id, pharmacy_id
      HAVING bool_and(is_last_page) = false AND MAX(received_at) < ${cutoff}
    `)
    return extractSessionRows(result).map((row) => ({
      fullSyncSessionId: row.fullSyncSessionId,
      pharmacyId: row.pharmacyId,
      lastPageReceivedAt: new Date(row.lastPageReceivedAt),
    }))
  }

}

interface SessionRow {
  readonly fullSyncSessionId: string
  readonly pharmacyId: string
  readonly lastPageReceivedAt: string | Date
}

/** Нормализация результата `db.execute` (тот же приём, что `postgres-pharmacy-map.adapter.ts`). */
function extractSessionRows(result: unknown): readonly SessionRow[] {
  if (Array.isArray(result)) {
    return result as SessionRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as SessionRow[]
    }
  }
  return []
}

export const INVENTORY_SYNC_BATCH_DRIZZLE_PROVIDER = {
  provide: INVENTORY_SYNC_BATCH_REPOSITORY,
  useClass: DrizzleInventorySyncBatchRepository,
} as const
