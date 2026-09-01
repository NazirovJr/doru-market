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
import { InventorySyncBatch } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type CreateInventorySyncBatchInput,
  type IncompleteFullSyncSession,
  type InventorySyncBatchRepository,
  type InventorySyncRowError,
  type RawInventoryRow,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import type { InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'

@Injectable()
export class InMemoryInventorySyncBatchRepository implements InventorySyncBatchRepository {
  private readonly batches = new Map<string, InventorySyncBatch>()
  private readonly errors: InventorySyncRowError[] = []
  private readonly rawItems = new Map<string, RawInventoryRow[]>()

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
  async findById(id: string): Promise<InventorySyncBatch | null> {
    return this.batches.get(id) ?? null
  }

  async save(batch: InventorySyncBatch): Promise<void> {
    this.batches.set(batch.id, batch)
  }

  async appendErrors(errors: readonly InventorySyncRowError[]): Promise<void> {
    for (let i = 0; i < errors.length; i += 1) {
      this.errors.push(errors[i]!)
    }
  }

  async findRawItems(batchId: string): Promise<readonly RawInventoryRow[]> {
    return this.rawItems.get(batchId) ?? []
  }

  async createIfNotExists(input: {
    readonly id: string
    readonly pharmacyId: string
    readonly channel: 'rest' | 'excel' | 'manual'
    readonly syncType: 'delta' | 'full'
    readonly fullSyncSessionId: string | null
    readonly isLastPage: boolean
    readonly totalRows: number
    readonly note: string | null
    readonly now: Date
  }): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    const existing = this.batches.get(input.id)
    if (existing !== undefined) {
      return { batch: existing, created: false }
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
      },
      input.now,
    )
    this.batches.set(input.id, created)
    return { batch: created, created: true }
  }

  async appendRawItems(
    batchId: string,
    items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void> {
    const existing = this.rawItems.get(batchId) ?? []
    const merged: RawInventoryRow[] = [...existing]
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] as { rowIndex: number; payload: Readonly<Record<string, unknown>> }
      merged.push({ rowIndex: it.rowIndex, payload: it.payload })
    }
    this.rawItems.set(batchId, merged)
  }

  async findIncompleteFullSyncSessions(
    olderThanMinutes: number,
  ): Promise<readonly IncompleteFullSyncSession[]> {
    // Простая реализация: группируем по (fullSyncSessionId, pharmacyId),
    // исключаем сессии с уже применённой last-page, фильтруем по
    // `lastReceivedAt < now - olderThanMinutes`.
    const now = new Date()
    const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000)
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
    return result
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
