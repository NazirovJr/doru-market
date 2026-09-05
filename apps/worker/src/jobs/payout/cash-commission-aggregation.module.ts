/**
 * NestJS-модуль `cash-commission-aggregation` (DTJ-251). Связывает `CashCommissionAggregationPort`
 * с реальным `pg.Pool`-адаптером (`platform_billing_invoices`/`processed_events`/`orders`/
 * `order_items`/`pharmacies` уже существуют к моменту этого тикета — заглушка не нужна, зеркало
 * `payout-scheduler.module.ts`). Создаёт собственный `pg.Pool` и BullMQ `Queue` (ОДНА очередь,
 * см. JSDoc scheduler'а). Закрывает оба при остановке процесса.
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
import { PgCashCommissionAggregationAdapter } from './pg-cash-commission-aggregation.adapter.js'
import {
  CASH_COMMISSION_AGGREGATION_DAILY_CRON,
  CASH_COMMISSION_AGGREGATION_DB_POOL,
  CASH_COMMISSION_AGGREGATION_QUEUE,
  CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON,
} from './cash-commission-aggregation.constants.js'
import { CASH_COMMISSION_AGGREGATION_PORT, CashCommissionAggregationJob } from './cash-commission-aggregation.job.js'
import { CashCommissionAggregationScheduleConfig, CashCommissionAggregationScheduler } from './cash-commission-aggregation.scheduler.js'

@Module({
  providers: [
    {
      provide: CASH_COMMISSION_AGGREGATION_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: CASH_COMMISSION_AGGREGATION_DAILY_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('CASH_COMMISSION_AGGREGATION_DAILY_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(CASH_COMMISSION_AGGREGATION_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: CASH_COMMISSION_AGGREGATION_PORT, useClass: PgCashCommissionAggregationAdapter },
    CashCommissionAggregationScheduleConfig,
    CashCommissionAggregationJob,
    CashCommissionAggregationScheduler,
  ],
})
export class CashCommissionAggregationModule implements OnModuleDestroy {
  constructor(
    @Inject(CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN) private readonly aggregationQueue: Queue,
    @Inject(CASH_COMMISSION_AGGREGATION_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.aggregationQueue.close(), this.pool.end()])
  }
}
