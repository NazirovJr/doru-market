/**
 * InMemory-реализация `InventoryOutboxPort` (EP-05, DTJ-147/152).
 *
 * Только для unit/integration-тестов. Реальный outbox (таблица `outbox`
 * в БД) реализуется на уровне infrastructure/database (см. EP-01,
 * `infrastructure/database/drizzle.provider.ts`).
 */
import {
  INVENTORY_OUTBOX,
  type FullSyncSessionStuckEvent,
  type InventoryBatchQueuedEvent,
  type InventoryOutboxPort,
  type UnmatchedInventoryRowEvent,
} from '@/modules/inventory/application/ports/inventory-outbox.port.js'

const MS_PER_MINUTE = 60_000

interface StoredEvent {
  readonly type: string
  readonly aggregateId: string
  readonly payload: unknown
  readonly at: Date
}

export class InMemoryInventoryOutbox implements InventoryOutboxPort {
  public readonly events: UnmatchedInventoryRowEvent[] = []
  public readonly stuckEvents: FullSyncSessionStuckEvent[] = []
  public readonly batchQueuedEvents: InventoryBatchQueuedEvent[] = []
  private readonly all: StoredEvent[] = []

  append(event: UnmatchedInventoryRowEvent): void {
    this.events.push(event)
    this.all.push({
      type: event.eventType,
      aggregateId: `${event.pharmacyId}::${event.rawRowPayload.internalSku}`,
      payload: event,
      at: new Date(),
    })
  }

  appendStuckSession(event: FullSyncSessionStuckEvent): void {
    this.stuckEvents.push(event)
    this.all.push({
      type: event.eventType,
      aggregateId: event.fullSyncSessionId,
      payload: event,
      at: new Date(),
    })
  }

  appendBatchQueued(event: InventoryBatchQueuedEvent): void {
    this.batchQueuedEvents.push(event)
    this.all.push({
      type: event.eventType,
      aggregateId: event.batchId,
      payload: event,
      at: new Date(),
    })
  }

  hasStuckAlert(fullSyncSessionId: string, withinMinutes: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - withinMinutes * MS_PER_MINUTE)
    return Promise.resolve(
      this.all.some(
        (e) =>
          e.type === 'inventory.full_sync_session.stuck' &&
          e.aggregateId === fullSyncSessionId &&
          e.at >= cutoff,
      ),
    )
  }
}

export const INVENTORY_OUTBOX_INMEMORY_PROVIDER = {
  provide: INVENTORY_OUTBOX,
  useClass: InMemoryInventoryOutbox,
} as const

