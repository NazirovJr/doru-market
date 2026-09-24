import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// @/ алиас не резолвится в раннтайме (см. обоснование в common/health/health.service.ts) —
// относительный путь до правки nest-cli.json.
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
import { PgOutboxReaderAdapter } from './pg-outbox-reader.adapter.js'
import {
  DOMAIN_EVENTS_QUEUE,
  OUTBOX_RELAY_DB_POOL,
  OUTBOX_RELAY_QUEUE,
  OUTBOX_RELAY_QUEUE_NAME,
} from './outbox-relay.constants.js'
import { OutboxRelayProcessor } from './outbox-relay.processor.js'
import { OutboxRelayScheduler } from './outbox-relay.scheduler.js'
import { OUTBOX_READER_PORT } from './outbox-reader.port.js'

// Связывает порт с реальным Pg-адаптером, создаёт собственный pg.Pool и обе BullMQ Queue,
// закрывает всё при остановке процесса.
@Module({
  providers: [
    {
      provide: OUTBOX_RELAY_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    { provide: OUTBOX_READER_PORT, useClass: PgOutboxReaderAdapter },
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
    @Inject(OUTBOX_RELAY_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.domainEventsQueue.close(), this.relayQueue.close(), this.pool.end()])
  }
}
