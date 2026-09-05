/**
 * NestJS-модуль `unpaid-order-timeout` (DTJ-253). Связывает `UnpaidOrderScannerPort` с реальным
 * `pg.Pool`-адаптером (только `SELECT`, `orders` уже существует — заглушка не нужна, зеркало
 * `escrow-reconciliation.module.ts`). Создаёт собственный `pg.Pool` (один тик — одно соединение)
 * и BullMQ `Queue`. `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN` — ОБЩИЕ токены с DTJ-254
 * (`system-order-cancel.client.ts`), каждый job-модуль независимо биндит их той же
 * `useFactory`-фабрикой над ТЕМИ ЖЕ ENV-переменными.
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
import { PgUnpaidOrderScannerAdapter } from './pg-unpaid-order-scanner.adapter.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from './system-order-cancel.client.js'
import {
  UNPAID_ORDER_TIMEOUT_CRON,
  UNPAID_ORDER_TIMEOUT_DB_POOL,
  UNPAID_ORDER_TIMEOUT_QUEUE,
  UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN,
} from './unpaid-order-timeout.constants.js'
import { UNPAID_ORDER_SCANNER, UnpaidOrderTimeoutJob } from './unpaid-order-timeout.job.js'
import { UnpaidOrderTimeoutScheduleConfig, UnpaidOrderTimeoutScheduler } from './unpaid-order-timeout.scheduler.js'

@Module({
  providers: [
    {
      provide: UNPAID_ORDER_TIMEOUT_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: UNPAID_ORDER_TIMEOUT_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('UNPAID_ORDER_TIMEOUT_CRON', { infer: true }),
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
      provide: UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(UNPAID_ORDER_TIMEOUT_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: UNPAID_ORDER_SCANNER, useClass: PgUnpaidOrderScannerAdapter },
    UnpaidOrderTimeoutScheduleConfig,
    UnpaidOrderTimeoutJob,
    UnpaidOrderTimeoutScheduler,
  ],
})
export class UnpaidOrderTimeoutModule implements OnModuleDestroy {
  constructor(
    @Inject(UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN) private readonly timeoutQueue: Queue,
    @Inject(UNPAID_ORDER_TIMEOUT_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.timeoutQueue.close(), this.pool.end()])
  }
}
