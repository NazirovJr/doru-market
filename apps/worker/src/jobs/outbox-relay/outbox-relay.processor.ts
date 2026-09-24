import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DOMAIN_EVENTS_QUEUE, OUTBOX_RELAY_BATCH_LIMIT } from './outbox-relay.constants.js'
import { OUTBOX_READER_PORT, type OutboxEventRecord, type OutboxReaderPort } from './outbox-reader.port.js'

// Публикация в Redis идёт конкурентно (падение одной строки не роняет тик), а мутация статуса —
// последовательно: markPublished/recordFailure делят один pg.PoolClient транзакции батча.
@Injectable()
export class OutboxRelayProcessor {
  private readonly logger = new Logger(OutboxRelayProcessor.name)

  constructor(
    @Inject(OUTBOX_READER_PORT) private readonly outboxReader: OutboxReaderPort,
    @Inject(DOMAIN_EVENTS_QUEUE) private readonly domainEventsQueue: Queue,
  ) {}

  /** Один тик: возвращает число заклеймленных строк outbox. */
  async relayOnce(): Promise<number> {
    const claim = await this.outboxReader.claimPending(OUTBOX_RELAY_BATCH_LIMIT)
    const outcomes = await Promise.allSettled(claim.events.map((event) => this.publish(event)))
    for (const [index, outcome] of outcomes.entries()) {
      const event = claim.events[index]
      if (event === undefined) continue // недостижимо: outcomes 1:1 с claim.events по построению выше.
      if (outcome.status === 'fulfilled') {
        // eslint-disable-next-line no-await-in-loop -- один pg.PoolClient на батч, см. комментарий выше.
        await claim.markPublished(event.id)
      } else {
        this.logger.error(`outbox-relay: публикация ${event.id} (${event.eventType}) не удалась — ${String(outcome.reason)}`)
        // eslint-disable-next-line no-await-in-loop -- см. обоснование выше.
        await claim.recordFailure(event.id)
      }
    }
    await claim.commit()
    this.logger.debug(`outbox-relay: тик обработал ${String(claim.events.length)} событие(й)`)
    return claim.events.length
  }

  private async publish(event: OutboxEventRecord): Promise<void> {
    await this.domainEventsQueue.add(event.eventType, toEnvelope(event), { jobId: event.id })
  }
}

function toEnvelope(event: OutboxEventRecord): DomainEventEnvelope {
  return {
    eventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  }
}
