import { describe, expect, it, vi } from 'vitest'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry } from '@/common/events/domain-event-handler.js'
import type { InventorySyncQueuePort } from '@/modules/inventory/application/ports/inventory-sync-queue.port.js'
import { InventoryBatchQueuedEventHandler } from './inventory-batch-queued.handler.js'

function makeEnvelope(): DomainEventEnvelope {
  return {
    eventId: 'evt-1',
    eventType: 'inventory.sync_batch.queued',
    aggregateType: 'inventory_sync_batch',
    aggregateId: 'batch-1',
    tenantId: 'tenant-1',
    occurredAt: new Date().toISOString(),
    payload: { batchId: 'batch-1', pharmacyId: 'pharmacy-1', channel: 'excel', syncType: 'delta' },
  }
}

describe('InventoryBatchQueuedEventHandler (DTJ-441)', () => {
  it('регистрируется в DomainEventHandlerRegistry на onModuleInit, подписан ровно на inventory.sync_batch.queued', () => {
    const registry = new DomainEventHandlerRegistry()
    const queue = { enqueue: vi.fn() } as unknown as InventorySyncQueuePort
    const handler = new InventoryBatchQueuedEventHandler(queue, registry)

    handler.onModuleInit()

    expect(registry.getHandlersFor('inventory.sync_batch.queued')).toEqual([handler])
    expect(registry.getHandlersFor('SomeOtherEvent')).toEqual([])
  })

  it('handle() делегирует InventorySyncQueuePort.enqueue(...) с полями payload — недостающее звено outbox → BullMQ', async () => {
    const registry = new DomainEventHandlerRegistry()
    const enqueue = vi.fn().mockResolvedValue(undefined)
    const queue = { enqueue } as unknown as InventorySyncQueuePort
    const handler = new InventoryBatchQueuedEventHandler(queue, registry)

    await handler.handle(makeEnvelope())

    expect(enqueue).toHaveBeenCalledWith({
      batchId: 'batch-1',
      pharmacyId: 'pharmacy-1',
      channel: 'excel',
      syncType: 'delta',
    })
  })
})
