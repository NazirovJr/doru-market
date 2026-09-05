/**
 * NestJS-модуль `payout-execution` (DTJ-250). Связывает `PayoutExecutionStorePort` с реальным
 * `pg.Pool`-адаптером (скан И мутация — обе через СОБСТВЕННЫЙ `pg.Pool`, см. JSDoc
 * `payout-execution.job.ts`), создаёт СОБСТВЕННЫЙ `pg.Pool` и BullMQ `Queue` — тот же приём, что
 * `unpaid-order-timeout.module.ts`/`pickup-sla-timeout.module.ts`. `API_INTERNAL_URL_TOKEN`/
 * `INTERNAL_API_KEY_TOKEN` — ОБЩИЕ токены с DTJ-253/254 (`system-order-cancel.client.ts`,
 * реэкспортированы `payout-transfer-batch.client.ts`) — этот модуль независимо биндит их своей
 * `useFactory`-фабрикой поверх ТЕХ ЖЕ ENV-переменных.
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
import { PgPayoutExecutionAdapter } from './pg-payout-execution.adapter.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from './payout-transfer-batch.client.js'
import {
  PAYOUT_BATCH_SIZE,
  PAYOUT_EXECUTION_CRON,
  PAYOUT_EXECUTION_DB_POOL,
  PAYOUT_EXECUTION_QUEUE,
  PAYOUT_EXECUTION_QUEUE_TOKEN,
} from './payout-execution.constants.js'
import { PAYOUT_EXECUTION_STORE, PayoutExecutionDeps, PayoutExecutionJob } from './payout-execution.job.js'
import { PayoutExecutionScheduleConfig, PayoutExecutionScheduler } from './payout-execution.scheduler.js'

@Module({
  providers: [
    {
      provide: PAYOUT_EXECUTION_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: PAYOUT_EXECUTION_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('PAYOUT_EXECUTION_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: PAYOUT_BATCH_SIZE,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('PAYOUT_BATCH_SIZE', { infer: true }),
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
      provide: PAYOUT_EXECUTION_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(PAYOUT_EXECUTION_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: PAYOUT_EXECUTION_STORE, useClass: PgPayoutExecutionAdapter },
    PayoutExecutionDeps,
    PayoutExecutionScheduleConfig,
    PayoutExecutionJob,
    PayoutExecutionScheduler,
  ],
})
export class PayoutExecutionModule implements OnModuleDestroy {
  constructor(
    @Inject(PAYOUT_EXECUTION_QUEUE_TOKEN) private readonly executionQueue: Queue,
    @Inject(PAYOUT_EXECUTION_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.executionQueue.close(), this.pool.end()])
  }
}
