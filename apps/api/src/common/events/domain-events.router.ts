import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from './domain-event-handler.js'
import { DOMAIN_EVENTS_REDIS_CONNECTION } from './domain-events-redis-connection.provider.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from './processed-events.port.js'

export const DOMAIN_EVENTS_QUEUE_NAME = 'domain-events'

// Единственный Worker на domain-events; идемпотентность по (consumerName, eventId) в processed_events — на уровне роутера.
@Injectable()
export class DomainEventsRouter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsRouter.name)
  private worker: Worker<DomainEventEnvelope> | undefined

  constructor(
    @Inject(DOMAIN_EVENTS_REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
    @Inject(PROCESSED_EVENTS_PORT) private readonly processedEvents: ProcessedEventsPort,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DomainEventEnvelope>(DOMAIN_EVENTS_QUEUE_NAME, (job) => this.route(job), {
      connection: this.connection,
    })
    this.worker.on('failed', (job, error) => {
      this.logFailure(job, error)
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
    const outcomes = await Promise.allSettled(handlers.map((handler) => this.runOnce(handler, envelope)))
    const failed = outcomes.flatMap((outcome, index) => (outcome.status === 'rejected' ? [{ handler: handlers[index], reason: outcome.reason as unknown }] : []))
    if (failed.length > 0) {
      const consumers = failed.map((f) => f.handler?.consumerName ?? '?').join(',')
      throw new Error(`consumers [${consumers}] failed: ${errorMessage(failed[0]?.reason)}`, { cause: failed[0]?.reason })
    }
  }

  private async runOnce(handler: DomainEventHandler, envelope: DomainEventEnvelope): Promise<void> {
    if (await this.processedEvents.isProcessed(handler.consumerName, envelope.eventId)) {
      return
    }
    await handler.handle(envelope)
    await this.processedEvents.markProcessed(handler.consumerName, envelope.eventId)
  }

  private logFailure(job: Job<DomainEventEnvelope> | undefined, error: Error): void {
    if (job === undefined) {
      this.logger.error(`domain-events: job без данных упал — ${error.message}`)
      return
    }
    const attempts = job.opts.attempts ?? 1
    const message = `domain-events: eventId=${job.data.eventId} (${job.name}) попытка ${String(job.attemptsMade)}/${String(attempts)} — ${error.message}`
    if (job.attemptsMade >= attempts) {
      this.logger.error(`${message} — ПОПЫТКИ ИСЧЕРПАНЫ, событие в failed-наборе`)
    } else {
      this.logger.warn(message)
    }
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
