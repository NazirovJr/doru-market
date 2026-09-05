/**
 * NestJS-модуль `pickup-sla-timeout` (DTJ-254). Зеркало `unpaid-order-timeout.module.ts` —
 * связывает `PickupSlaOrderScannerPort` с реальным `pg.Pool`-адаптером (только `SELECT`),
 * создаёт СОБСТВЕННЫЙ `pg.Pool` (один тик — одно соединение) и BullMQ `Queue`.
 * `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN` — ОБЩИЕ токены с DTJ-253
 * (`system-order-cancel.client.ts`, см. её JSDoc): этот модуль независимо биндит их той же
 * `useFactory`-фабрикой поверх ТЕХ ЖЕ ENV-переменных (`API_INTERNAL_URL`/`INTERNAL_API_KEY`) —
 * НЕ заводит вторую пару имён.
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
import { PgPickupSlaOrderScannerAdapter } from './pg-pickup-sla-order-scanner.adapter.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from './system-order-cancel.client.js'
import {
  PICKUP_SLA_TIMEOUT_CRON,
  PICKUP_SLA_TIMEOUT_DB_POOL,
  PICKUP_SLA_TIMEOUT_QUEUE,
  PICKUP_SLA_TIMEOUT_QUEUE_TOKEN,
} from './pickup-sla-timeout.constants.js'
import { PICKUP_SLA_ORDER_SCANNER, PickupSlaTimeoutJob } from './pickup-sla-timeout.job.js'
import { PickupSlaTimeoutScheduleConfig, PickupSlaTimeoutScheduler } from './pickup-sla-timeout.scheduler.js'

@Module({
  providers: [
    {
      provide: PICKUP_SLA_TIMEOUT_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: PICKUP_SLA_TIMEOUT_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('PICKUP_SLA_TIMEOUT_CRON', { infer: true }),
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
      provide: PICKUP_SLA_TIMEOUT_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(PICKUP_SLA_TIMEOUT_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: PICKUP_SLA_ORDER_SCANNER, useClass: PgPickupSlaOrderScannerAdapter },
    PickupSlaTimeoutScheduleConfig,
    PickupSlaTimeoutJob,
    PickupSlaTimeoutScheduler,
  ],
})
export class PickupSlaTimeoutModule implements OnModuleDestroy {
  constructor(
    @Inject(PICKUP_SLA_TIMEOUT_QUEUE_TOKEN) private readonly timeoutQueue: Queue,
    @Inject(PICKUP_SLA_TIMEOUT_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.timeoutQueue.close(), this.pool.end()])
  }
}
