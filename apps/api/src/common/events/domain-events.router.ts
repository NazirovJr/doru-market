import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry } from './domain-event-handler.js'
import { DOMAIN_EVENTS_REDIS_CONNECTION } from './domain-events-redis-connection.provider.js'

export const DOMAIN_EVENTS_QUEUE_NAME = 'domain-events'

// Единственный Worker на domain-events: fan-out по eventType; ошибка любого обработчика роняет
// job целиком в ретрай BullMQ (отработавшие защищены своей идемпотентностью).
@Injectable()
export class DomainEventsRouter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsRouter.name)
  private worker: Worker<DomainEventEnvelope> | undefined

  constructor(
    @Inject(DOMAIN_EVENTS_REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DomainEventEnvelope>(DOMAIN_EVENTS_QUEUE_NAME, (job) => this.route(job), {
      connection: this.connection,
    })
    this.worker.on('failed', (job, error) => {
      this.logger.error(`domain-events: job ${job?.id ?? '?'} (${job?.name ?? '?'}) failed — ${error.message}`)
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
    await this.connection.quit()
  }

  private async route(job: Job<DomainEventEnvelope>): Promise<void> {
    const envelope = job.data
    const handlers = this.registry.getHandlersFor(envelope.eventType)
    if (handlers.length === 0) {
      this.logger.debug(`domain-events: eventType=${envelope.eventType} без обработчиков — пропущено.`)
      return
    }
    await Promise.all(handlers.map((handler) => handler.handle(envelope)))
  }
}
