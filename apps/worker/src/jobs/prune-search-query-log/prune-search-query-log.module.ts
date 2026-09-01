/**
 * Связывает `SearchQueryLogRetentionPort` с реальным `PgSearchQueryLogRetentionAdapter`
 * (DTJ-181 — в отличие от `outbox-relay` этому тикету не нужна заглушка: таблица и retention-
 * DELETE создаются в этом же тикете, реализация тривиальна). Создаёт собственный `pg.Pool`
 * (одно соединение хватает — тик раз в сутки, не смешивается с health-check-пулом
 * `apps/api`) и BullMQ `Queue`. Закрывает оба при остановке процесса.
 */
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts). Относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts). Относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { PgSearchQueryLogRetentionAdapter } from './pg-search-query-log-retention.adapter.js'
import {
  PRUNE_SEARCH_QUERY_LOG_DB_POOL,
  PRUNE_SEARCH_QUERY_LOG_QUEUE,
  PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN,
  SEARCH_QUERY_LOG_RETENTION_DAYS,
} from './prune-search-query-log.constants.js'
import { PruneSearchQueryLogProcessor } from './prune-search-query-log.processor.js'
import { PruneSearchQueryLogScheduler } from './prune-search-query-log.scheduler.js'
import { SEARCH_QUERY_LOG_RETENTION_PORT } from './search-query-log-retention.port.js'

@Module({
  providers: [
    {
      provide: PRUNE_SEARCH_QUERY_LOG_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: SEARCH_QUERY_LOG_RETENTION_DAYS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('SEARCH_QUERY_LOG_RETENTION_DAYS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(PRUNE_SEARCH_QUERY_LOG_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: SEARCH_QUERY_LOG_RETENTION_PORT, useClass: PgSearchQueryLogRetentionAdapter },
    PruneSearchQueryLogProcessor,
    PruneSearchQueryLogScheduler,
  ],
})
export class PruneSearchQueryLogModule implements OnModuleDestroy {
  constructor(
    @Inject(PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN) private readonly pruneQueue: Queue,
    @Inject(PRUNE_SEARCH_QUERY_LOG_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pruneQueue.close(), this.pool.end()])
  }
}
