/**
 * NestJS-модуль `payout-scheduler` (DTJ-249). Связывает `PayoutSchedulerPort` с реальным
 * `pg.Pool`-адаптером (`payout_schedule`/`orders` уже существуют — заглушка не нужна, зеркало
 * `unpaid-order-timeout.module.ts`). Создаёт собственный `pg.Pool` (один тик в час — одно
 * соединение) и BullMQ `Queue`. Закрывает оба при остановке процесса.
 */
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { PgPayoutSchedulerAdapter } from './pg-payout-scheduler.adapter.js'
import {
  PAYOUT_SCHEDULER_CRON,
  PAYOUT_SCHEDULER_DB_POOL,
  PAYOUT_SCHEDULER_QUEUE,
  PAYOUT_SCHEDULER_QUEUE_TOKEN,
} from './payout-scheduler.constants.js'
import { PAYOUT_SCHEDULER_PORT, PayoutSchedulerJob } from './payout-scheduler.job.js'
import { PayoutSchedulerScheduleConfig, PayoutSchedulerScheduler } from './payout-scheduler.scheduler.js'

@Module({
  providers: [
    {
      provide: PAYOUT_SCHEDULER_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: PAYOUT_SCHEDULER_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string => configService.get('PAYOUT_SCHEDULER_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: PAYOUT_SCHEDULER_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(PAYOUT_SCHEDULER_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: PAYOUT_SCHEDULER_PORT, useClass: PgPayoutSchedulerAdapter },
    PayoutSchedulerScheduleConfig,
    PayoutSchedulerJob,
    PayoutSchedulerScheduler,
  ],
})
export class PayoutSchedulerModule implements OnModuleDestroy {
  constructor(
    @Inject(PAYOUT_SCHEDULER_QUEUE_TOKEN) private readonly schedulerQueue: Queue,
    @Inject(PAYOUT_SCHEDULER_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.schedulerQueue.close(), this.pool.end()])
  }
}
