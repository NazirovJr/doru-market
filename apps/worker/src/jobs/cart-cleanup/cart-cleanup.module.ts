/**
 * Связывает `CartCleanupRetentionPort` с реальным `PgCartCleanupRetentionAdapter` (DTJ-224 —
 * зеркало `prune-search-query-log.module.ts`: таблица уже существует, реализация тривиальна,
 * заглушка не нужна). Создаёт собственный `pg.Pool` (одно соединение — тик раз в сутки) и
 * BullMQ `Queue`. Закрывает оба при остановке процесса.
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
import { PgCartCleanupRetentionAdapter } from './pg-cart-cleanup-retention.adapter.js'
import {
  CART_ABANDONED_GUEST_TTL_DAYS,
  CART_ABANDONED_TTL_DAYS,
  CART_CLEANUP_DB_POOL,
  CART_CLEANUP_QUEUE,
  CART_CLEANUP_QUEUE_TOKEN,
} from './cart-cleanup.constants.js'
import { CartAbandonedCleanupJob } from './cart-abandoned-cleanup.job.js'
import { CartCleanupScheduler } from './cart-cleanup.scheduler.js'
import { CART_CLEANUP_RETENTION_PORT } from './cart-cleanup-retention.port.js'

@Module({
  providers: [
    {
      provide: CART_CLEANUP_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: CART_ABANDONED_TTL_DAYS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('CART_ABANDONED_TTL_DAYS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: CART_ABANDONED_GUEST_TTL_DAYS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('CART_ABANDONED_GUEST_TTL_DAYS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: CART_CLEANUP_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(CART_CLEANUP_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: CART_CLEANUP_RETENTION_PORT, useClass: PgCartCleanupRetentionAdapter },
    CartAbandonedCleanupJob,
    CartCleanupScheduler,
  ],
})
export class CartCleanupModule implements OnModuleDestroy {
  constructor(
    @Inject(CART_CLEANUP_QUEUE_TOKEN) private readonly cleanupQueue: Queue,
    @Inject(CART_CLEANUP_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.cleanupQueue.close(), this.pool.end()])
  }
}
