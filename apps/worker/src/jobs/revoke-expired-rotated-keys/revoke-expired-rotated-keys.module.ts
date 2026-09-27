import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { PgExpiredRotatedKeyScannerAdapter } from './pg-expired-rotated-key-scanner.adapter.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from './revoke-expired-rotated-key.client.js'
import {
  REVOKE_EXPIRED_ROTATED_KEYS_CRON,
  REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL,
  REVOKE_EXPIRED_ROTATED_KEYS_QUEUE,
  REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN,
} from './revoke-expired-rotated-keys.constants.js'
import { EXPIRED_ROTATED_KEY_SCANNER, RevokeExpiredRotatedKeysJob } from './revoke-expired-rotated-keys.job.js'
import { RevokeExpiredRotatedKeysScheduleConfig, RevokeExpiredRotatedKeysScheduler } from './revoke-expired-rotated-keys.scheduler.js'

@Module({
  providers: [
    {
      provide: REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: REVOKE_EXPIRED_ROTATED_KEYS_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('REVOKE_EXPIRED_ROTATED_KEYS_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: API_INTERNAL_URL_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('API_INTERNAL_URL', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: INTERNAL_API_KEY_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string | undefined =>
        configService.get('INTERNAL_API_KEY', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(REVOKE_EXPIRED_ROTATED_KEYS_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: EXPIRED_ROTATED_KEY_SCANNER, useClass: PgExpiredRotatedKeyScannerAdapter },
    RevokeExpiredRotatedKeysScheduleConfig,
    RevokeExpiredRotatedKeysJob,
    RevokeExpiredRotatedKeysScheduler,
  ],
})
export class RevokeExpiredRotatedKeysModule implements OnModuleDestroy {
  constructor(
    @Inject(REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.queue.close(), this.pool.end()])
  }
}
