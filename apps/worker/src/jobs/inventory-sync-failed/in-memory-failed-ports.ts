/**
 * InMemory-порты для `inventory-sync-failed` (EP-05, DTJ-155, R1-бутстрап).
 *
 * TODO(EP-19, DTJ-154 follow-up): заменить на Drizzle-реализации
 * (worker-side тонкие адаптеры над теми же таблицами).
 */
import { Injectable } from '@nestjs/common'
import type { ClockPort, InventoryOutboxPort, InventorySyncBatchRepositoryPort, InventorySyncBatchSnapshot, ProcessingFailedAlertEvent } from './inventory-sync-ports.js'

export const INVENTORY_SYNC_BATCH_REPOSITORY_PORT = Symbol.for('@dorutj/worker/inventory-sync-batch-repository')
export const INVENTORY_OUTBOX_PORT = Symbol.for('@dorutj/worker/inventory-outbox')
export const LOGGER = Symbol.for('@dorutj/worker/logger')

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date()
  }
}

@Injectable()
export class InMemoryInventorySyncBatchRepository implements InventorySyncBatchRepositoryPort {
  private readonly store = new Map<string, InventorySyncBatchSnapshot>()
  public readonly errors: {
    batchId: string
    rowIndex: number | null
    errorCode: string
    errorDetail: string
  }[] = []

  async findById(id: string): Promise<InventorySyncBatchSnapshot | null> {
    return this.store.get(id) ?? null
  }

  async save(batch: InventorySyncBatchSnapshot): Promise<void> {
    this.store.set(batch.id, batch)
  }

  async appendError(input: {
    batchId: string
    rowIndex: number | null
    errorCode: string
    errorDetail: string
  }): Promise<void> {
    this.errors.push(input)
  }
}

@Injectable()
export class InMemoryInventoryOutbox implements InventoryOutboxPort {
  public readonly alerts: ProcessingFailedAlertEvent[] = []
  appendProcessingFailedAlert(event: ProcessingFailedAlertEvent): void {
    this.alerts.push(event)
  }
}
