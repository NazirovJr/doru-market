import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { DOMAIN_EVENTS_QUEUE, OUTBOX_RELAY_BATCH_LIMIT } from './outbox-relay.constants.js'
import { OUTBOX_READER_PORT, type OutboxEventRecord, type OutboxReaderPort } from './outbox-reader.port.js'

/**
 * Ядро джобы outbox-relay: читает порцию `outbox` через порт, публикует каждую строку в очередь
 * `domain-events` (`jobId = event.id` — встроенная дедупликация BullMQ поверх основной гарантии
 * `processed_events` на стороне потребителя, см. «Риски» тикета DTJ-002), помечает опубликованной.
 * Планирование тика (BullMQ `repeat`) — отдельно, `outbox-relay.scheduler.ts`, чтобы эта логика
 * оставалась юнит-тестируемой без реального BullMQ `Worker`.
 */
@Injectable()
export class OutboxRelayProcessor {
  private readonly logger = new Logger(OutboxRelayProcessor.name)

  constructor(
    @Inject(OUTBOX_READER_PORT) private readonly outboxReader: OutboxReaderPort,
    @Inject(DOMAIN_EVENTS_QUEUE) private readonly domainEventsQueue: Queue,
  ) {}

  /** Один тик: возвращает число обработанных строк outbox. */
  async relayOnce(): Promise<number> {
    const pending = await this.outboxReader.readPending(OUTBOX_RELAY_BATCH_LIMIT)
    await Promise.all(pending.map((event) => this.publishAndMark(event)))
    this.logger.debug(`outbox-relay: тик обработал ${String(pending.length)} событие(й)`)
    return pending.length
  }

  private async publishAndMark(event: OutboxEventRecord): Promise<void> {
    await this.domainEventsQueue.add(event.eventType, event.payload, { jobId: event.id })
    await this.outboxReader.markPublished(event.id)
  }
}
