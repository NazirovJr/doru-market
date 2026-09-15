/**
 * In-memory `InventorySyncBatchRepository` (EP-05, DTJ-144, DTJ-148) — заглушка.
 * Drizzle-реализация пишет в `inventory_sync_batch` (DTJ-154).
 *
 * Поддерживает ОБА интерфейса:
 *   - плоский `create` + `markStatus` (R1-бутстрап, deprecated);
 *   - агрегатный `findById` + `save` + `appendErrors` + `findRawItems` (R1-полный, DTJ-148).
 */
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  InventorySyncBatch,
  type InventorySyncBatchSnapshot,
} from '@/modules/inventory/domain/inventory-sync-batch.entity.js'

const MS_PER_MINUTE = 60_000
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type CreateInventorySyncBatchInput,
  type IncompleteFullSyncSession,
  type InventoryRowErrorDetail,
  type InventorySyncBatchRepository,
  type InventorySyncRowError,
  type RawInventoryRow,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import type { InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'

const MIN_TOTAL_ROWS_FOR_REPORT = 0

@Injectable()
export class InMemoryInventorySyncBatchRepository implements InventorySyncBatchRepository {
  private readonly batches = new Map<string, InventorySyncBatch>()
  private readonly errors: InventorySyncRowError[] = []
  private readonly rawItems = new Map<string, RawInventoryRow[]>()
  /** DTJ-158/163/164 test-only: `pharmacyId → chainId` (см. `seedPharmacyChainId`). */
  private readonly pharmacyChainIds = new Map<string, string | null>()

  // Плоский API (R1-бутстрап, deprecated) ------------------------------------
  async create(
    _input: CreateInventorySyncBatchInput,
  ): Promise<{ readonly id: string }> {
    return Promise.resolve({ id: randomUUID() })
  }

  async markStatus(_id: string, _status: InventorySyncStatus): Promise<void> {
    return Promise.resolve()
  }

  // Агрегатный API (R1-полный, DTJ-148) ---------------------------------------
  findById(id: string): Promise<InventorySyncBatch | null> {
    return Promise.resolve(this.batches.get(id) ?? null)
  }

  save(batch: InventorySyncBatch): Promise<void> {
    this.batches.set(batch.id, batch)
    return Promise.resolve()
  }

  appendErrors(errors: readonly InventorySyncRowError[]): Promise<void> {
    for (const error of errors) {
      this.errors.push(error)
    }
    return Promise.resolve()
  }

  findRawItems(batchId: string): Promise<readonly RawInventoryRow[]> {
    return Promise.resolve(this.rawItems.get(batchId) ?? [])
  }

  createIfNotExists(input: {
    readonly id: string
    readonly pharmacyId: string
    readonly channel: 'rest' | 'excel' | 'manual'
    readonly syncType: 'delta' | 'full'
    readonly fullSyncSessionId: string | null
    readonly isLastPage: boolean
    readonly totalRows: number
    readonly note: string | null
    readonly now: Date
    readonly sourceUploadId?: string | null
  }): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    const existing = this.batches.get(input.id)
    if (existing !== undefined) {
      return Promise.resolve({ batch: existing, created: false })
    }
    const channel: 'rest' | 'excel' | 'manual' = input.channel
    const created = InventorySyncBatch.create(
      {
        id: input.id,
        pharmacyId: input.pharmacyId,
        channel,
        syncType: input.syncType,
        totalRows: input.totalRows,
        ...(input.fullSyncSessionId !== null ? { fullSyncSessionId: input.fullSyncSessionId } : {}),
        ...(input.syncType === 'full' ? { isLastPage: input.isLastPage } : {}),
        ...(input.sourceUploadId !== null && input.sourceUploadId !== undefined
          ? { sourceUploadId: input.sourceUploadId }
          : {}),
      },
      input.now,
    )
    this.batches.set(input.id, created)
    return Promise.resolve({ batch: created, created: true })
  }

  // ── DTJ-158/163/164 (отчёт кабинета + поллинг-статус) ──────────────────

  findPharmacyChainId(pharmacyId: string): Promise<string | null> {
    return Promise.resolve(this.pharmacyChainIds.get(pharmacyId) ?? null)
  }

  findManyForReport(input: {
    readonly pharmacyId: string | null
    readonly chainId: string | null
    readonly cursor: { readonly v: string; readonly id: string } | null
    readonly limit: number
  }): Promise<{ readonly items: readonly InventorySyncBatchSnapshot[]; readonly hasMore: boolean }> {
    const scoped = this.scopeBatchesForReport(input.pharmacyId, input.chainId)
    const sorted = this.sortForReport(scoped)
    const afterCursor = input.cursor === null ? sorted : this.applyReportCursor(sorted, input.cursor)
    const hasMore = afterCursor.length > input.limit
    const page = hasMore ? afterCursor.slice(0, input.limit) : afterCursor
    return Promise.resolve({ items: page.map((b) => b.toSnapshot()), hasMore })
  }

  private scopeBatchesForReport(
    pharmacyId: string | null,
    chainId: string | null,
  ): InventorySyncBatch[] {
    const all = Array.from(this.batches.values()).filter((b) => b.totalRows > MIN_TOTAL_ROWS_FOR_REPORT)
    if (chainId !== null) {
      return all.filter((b) => this.pharmacyChainIds.get(b.pharmacyId) === chainId)
    }
    if (pharmacyId !== null) {
      return all.filter((b) => b.pharmacyId === pharmacyId)
    }
    return all
  }

  private sortForReport(batches: readonly InventorySyncBatch[]): InventorySyncBatch[] {
    return [...batches].sort((a, b) => {
      const byReceivedAt = b.receivedAt.getTime() - a.receivedAt.getTime()
      if (byReceivedAt !== 0) return byReceivedAt
      if (a.id === b.id) return 0
      return a.id < b.id ? 1 : -1
    })
  }

  /** Keyset-курсор: оставляет строго то, что идёт ПОСЛЕ курсора в том же (desc) порядке. */
  private applyReportCursor(
    sorted: readonly InventorySyncBatch[],
    cursor: { readonly v: string; readonly id: string },
  ): InventorySyncBatch[] {
    const cursorTime = new Date(cursor.v).getTime()
    return sorted.filter((b) => {
      const t = b.receivedAt.getTime()
      if (t !== cursorTime) return t < cursorTime
      return b.id < cursor.id
    })
  }

  findRowErrorsByBatchId(batchId: string): Promise<readonly InventoryRowErrorDetail[]> {
    const rawByIndex = new Map((this.rawItems.get(batchId) ?? []).map((r) => [r.rowIndex, r.payload]))
    const forBatch = this.errors
      .filter((e) => e.batchId === batchId)
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .map((e) => ({
        rowIndex: e.rowIndex,
        errorCode: e.errorCode,
        reason: e.reason,
        rawRow: rawByIndex.get(e.rowIndex) ?? null,
      }))
    return Promise.resolve(forBatch)
  }

  findBySourceUploadId(sourceUploadId: string): Promise<readonly InventorySyncBatchSnapshot[]> {
    const items = Array.from(this.batches.values())
      .filter((b) => b.sourceUploadId === sourceUploadId)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((b) => b.toSnapshot())
    return Promise.resolve(items)
  }

  /** TEST-ONLY: настроить `chain_id` аптеки (для проверки скоупа отчёта DTJ-163/158). */
  seedPharmacyChainId(pharmacyId: string, chainId: string | null): void {
    this.pharmacyChainIds.set(pharmacyId, chainId)
  }

  appendRawItems(
    batchId: string,
    items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void> {
    const existing = this.rawItems.get(batchId) ?? []
    const merged: RawInventoryRow[] = [...existing]
    for (const it of items) {
      merged.push({ rowIndex: it.rowIndex, payload: it.payload })
    }
    this.rawItems.set(batchId, merged)
    return Promise.resolve()
  }

  findIncompleteFullSyncSessions(
    olderThanMinutes: number,
  ): Promise<readonly IncompleteFullSyncSession[]> {
    // Простая реализация: группируем по (fullSyncSessionId, pharmacyId),
    // исключаем сессии с уже применённой last-page, фильтруем по
    // `lastReceivedAt < now - olderThanMinutes`.
    const now = new Date()
    const cutoff = new Date(now.getTime() - olderThanMinutes * MS_PER_MINUTE)
    const grouped = new Map<string, IncompleteFullSyncSession>()
    for (const batch of this.batches.values()) {
      if (batch.syncType !== 'full' || batch.fullSyncSessionId === null) continue
      const key = `${batch.fullSyncSessionId}::${batch.pharmacyId}`
      const existing = grouped.get(key)
      if (existing === undefined || batch.receivedAt > existing.lastPageReceivedAt) {
        grouped.set(key, {
          fullSyncSessionId: batch.fullSyncSessionId,
          pharmacyId: batch.pharmacyId,
          lastPageReceivedAt: batch.receivedAt,
        })
      }
    }
    const result: IncompleteFullSyncSession[] = []
    for (const session of grouped.values()) {
      // `bool_and(is_last_page)=false` означает «последняя страница
      // ещё не пришла» — сессия должна быть хоть ОДНА страница без
      // `isLastPage=true`.
      const hasLastPage = Array.from(this.batches.values()).some(
        (b) =>
          b.fullSyncSessionId === session.fullSyncSessionId &&
          b.pharmacyId === session.pharmacyId &&
          b.isLastPage,
      )
      if (hasLastPage) continue
      if (session.lastPageReceivedAt >= cutoff) continue
      result.push(session)
    }
    return Promise.resolve(result)
  }

  /** TEST-ONLY: сохранить raw items (для теста воркера). */
  seedRawItems(batchId: string, items: readonly RawInventoryRow[]): void {
    this.rawItems.set(batchId, [...items])
  }

  /** TEST-ONLY: прочитать все накопленные ошибки. */
  getAllErrors(): readonly InventorySyncRowError[] {
    return this.errors
  }
}

export { INVENTORY_SYNC_BATCH_REPOSITORY }
