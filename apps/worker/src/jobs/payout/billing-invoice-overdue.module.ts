/**
 * NestJS-модуль `billing-invoice-overdue` (DTJ-252). Связывает `BillingInvoiceOverduePort` с
 * реальным `pg.Pool`-адаптером (`platform_billing_invoices` уже существует с DTJ-251 — заглушка
 * не нужна, зеркало `unpaid-order-timeout.module.ts`/`cash-commission-aggregation.module.ts`).
 * Создаёт собственный `pg.Pool` и BullMQ `Queue`, закрывает оба при остановке процесса.
 *
 * `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN` — ОБЩИЕ токены с DTJ-253/254 (см. JSDoc
 * `suspend-chain.client.ts`) — этот модуль НЕЗАВИСИМО биндит их своей `useFactory` над ТЕМИ ЖЕ
 * ENV, тот же приём, что `UnpaidOrderTimeoutModule`. `SUSPEND_CHAIN_CLIENT_DEPS` — агрегирует
 * оба в один инжектируемый объект для `BillingInvoiceOverdueJob` (см. JSDoc константы, C5).
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
import { PgBillingInvoiceOverdueAdapter } from './pg-billing-invoice-overdue.adapter.js'
import {
  BILLING_INVOICE_OVERDUE_CRON,
  BILLING_INVOICE_OVERDUE_DB_POOL,
  BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS,
  BILLING_INVOICE_OVERDUE_QUEUE,
  BILLING_INVOICE_OVERDUE_QUEUE_TOKEN,
  SUSPEND_CHAIN_CLIENT_DEPS,
} from './billing-invoice-overdue.constants.js'
import { BILLING_INVOICE_OVERDUE_PORT, BillingInvoiceOverdueJob } from './billing-invoice-overdue.job.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN, type SuspendChainClientDeps } from './suspend-chain.client.js'
import { BillingInvoiceOverdueScheduleConfig, BillingInvoiceOverdueScheduler } from './billing-invoice-overdue.scheduler.js'

@Module({
  providers: [
    {
      provide: BILLING_INVOICE_OVERDUE_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: BILLING_INVOICE_OVERDUE_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('BILLING_INVOICE_OVERDUE_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: API_INTERNAL_URL_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string => configService.get('API_INTERNAL_URL', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: INTERNAL_API_KEY_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string | undefined =>
        configService.get('INTERNAL_API_KEY', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: SUSPEND_CHAIN_CLIENT_DEPS,
      useFactory: (apiInternalUrl: string, internalApiKey: string | undefined): SuspendChainClientDeps => ({ apiInternalUrl, internalApiKey }),
      inject: [API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN],
    },
    {
      provide: BILLING_INVOICE_OVERDUE_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(BILLING_INVOICE_OVERDUE_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: BILLING_INVOICE_OVERDUE_PORT, useClass: PgBillingInvoiceOverdueAdapter },
    BillingInvoiceOverdueScheduleConfig,
    BillingInvoiceOverdueJob,
    BillingInvoiceOverdueScheduler,
  ],
})
export class BillingInvoiceOverdueModule implements OnModuleDestroy {
  constructor(
    @Inject(BILLING_INVOICE_OVERDUE_QUEUE_TOKEN) private readonly overdueQueue: Queue,
    @Inject(BILLING_INVOICE_OVERDUE_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.overdueQueue.close(), this.pool.end()])
  }
}
