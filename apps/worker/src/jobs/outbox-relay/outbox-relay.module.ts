import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. обоснование в common/health/health.service.ts) —
// относительный путь до правки nest-cli.json.
// eslint-disable-next-line no-restricted-imports
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
import { NoopOutboxReaderAdapter } from './noop-outbox-reader.adapter.js'
import { DOMAIN_EVENTS_QUEUE, OUTBOX_RELAY_QUEUE, OUTBOX_RELAY_QUEUE_NAME } from './outbox-relay.constants.js'
import { OutboxRelayProcessor } from './outbox-relay.processor.js'
import { OutboxRelayScheduler } from './outbox-relay.scheduler.js'
import { OUTBOX_READER_PORT } from './outbox-reader.port.js'

/**
 * Связывает порт `OutboxReaderPort` с временной заглушкой (DTJ-016 заменит `useClass`) и
 * создаёт обе BullMQ `Queue` джобы outbox-relay: `domain-events` (целевая) и служебную
 * `outbox-relay` (тик планировщика). Закрывает обе очереди при остановке процесса.
 */
@Module({
  providers: [
    { provide: OUTBOX_READER_PORT, useClass: NoopOutboxReaderAdapter },
    {
      provide: DOMAIN_EVENTS_QUEUE,
      useFactory: (connection: Redis): Queue => new Queue(QUEUE_NAMES.DOMAIN_EVENTS, { connection }),
      inject: [REDIS_CONNECTION],
    },
    {
      provide: OUTBOX_RELAY_QUEUE,
      useFactory: (connection: Redis): Queue => new Queue(OUTBOX_RELAY_QUEUE_NAME, { connection }),
      inject: [REDIS_CONNECTION],
    },
    OutboxRelayProcessor,
    OutboxRelayScheduler,
  ],
})
export class OutboxRelayModule implements OnModuleDestroy {
  constructor(
    @Inject(DOMAIN_EVENTS_QUEUE) private readonly domainEventsQueue: Queue,
    @Inject(OUTBOX_RELAY_QUEUE) private readonly relayQueue: Queue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.domainEventsQueue.close(), this.relayQueue.close()])
  }
}
