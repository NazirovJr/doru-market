// Недостающее звено outbox → inventory-sync-queue (DTJ-441): без него InventoryBatchQueuedEvent
// доходил до generic domain-events роутера и терялся (нет обработчика), inventory-sync-queue.enqueue() не вызывался НИГДЕ.
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import {
  INVENTORY_SYNC_QUEUE,
  type InventorySyncJobData,
  type InventorySyncQueuePort,
} from '@/modules/inventory/application/ports/inventory-sync-queue.port.js'

const EVENT_TYPES = ['inventory.sync_batch.queued'] as const

@Injectable()
export class InventoryBatchQueuedEventHandler implements DomainEventHandler, OnModuleInit {
  public readonly consumerName = 'inventory.on-batch-queued'
  public readonly eventTypes: readonly string[] = EVENT_TYPES

  public constructor(
    @Inject(INVENTORY_SYNC_QUEUE) private readonly queue: InventorySyncQueuePort,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as InventorySyncJobData
    await this.queue.enqueue(payload)
  }
}
