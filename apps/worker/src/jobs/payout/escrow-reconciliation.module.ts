/**
 * NestJS-модуль `escrow-reconciliation` (DTJ-247). Связывает порты джобы (`EscrowReconciliation
 * ScannerPort`/`SupportTicketPort`/`AuditLogPort`, `escrow-reconciliation.job.ts`) с реальными
 * `pg.Pool`-адаптерами (таблицы существуют — `migrations/0034_support_tickets_audit_log.sql`,
 * заглушка не нужна, зеркало `cart-cleanup.module.ts`). Создаёт собственный `pg.Pool` (одно
 * соединение — тик раз в сутки) и BullMQ `Queue`. Закрывает оба при остановке процесса.
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
import { PgEscrowReconciliationScannerAdapter } from './pg-escrow-reconciliation-scanner.adapter.js'
import { PgSupportTicketAdapter } from './pg-support-ticket.adapter.js'
import { PgAuditLogAdapter } from './pg-audit-log.adapter.js'
import { EscrowLedgerImbalanceMetric } from './escrow-ledger-imbalance.metric.js'
import {
  ESCROW_RECONCILIATION_DB_POOL,
  ESCROW_RECONCILIATION_QUEUE,
  ESCROW_RECONCILIATION_QUEUE_TOKEN,
  RECONCILIATION_CRON,
  RECONCILIATION_DEDUP_DAYS,
} from './escrow-reconciliation.constants.js'
import {
  ESCROW_RECONCILIATION_SCANNER,
  AUDIT_LOG_PORT,
  SUPPORT_TICKET_PORT,
  EscrowReconciliationJob,
  EscrowReconciliationPorts,
} from './escrow-reconciliation.job.js'
import { EscrowReconciliationScheduler, ReconciliationScheduleConfig } from './escrow-reconciliation.scheduler.js'

@Module({
  providers: [
    {
      provide: ESCROW_RECONCILIATION_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: RECONCILIATION_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string => configService.get('RECONCILIATION_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: RECONCILIATION_DEDUP_DAYS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('RECONCILIATION_DEDUP_DAYS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: EscrowLedgerImbalanceMetric,
      useFactory: (configService: ConfigService<WorkerEnv, true>): EscrowLedgerImbalanceMetric =>
        new EscrowLedgerImbalanceMetric(configService.get('RECONCILIATION_METRIC_EXPORT_ENABLED', { infer: true })),
      inject: [ConfigService],
    },
    {
      provide: ESCROW_RECONCILIATION_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(ESCROW_RECONCILIATION_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: ESCROW_RECONCILIATION_SCANNER, useClass: PgEscrowReconciliationScannerAdapter },
    { provide: SUPPORT_TICKET_PORT, useClass: PgSupportTicketAdapter },
    { provide: AUDIT_LOG_PORT, useClass: PgAuditLogAdapter },
    EscrowReconciliationPorts,
    ReconciliationScheduleConfig,
    EscrowReconciliationJob,
    EscrowReconciliationScheduler,
  ],
})
export class EscrowReconciliationModule implements OnModuleDestroy {
  constructor(
    @Inject(ESCROW_RECONCILIATION_QUEUE_TOKEN) private readonly reconciliationQueue: Queue,
    @Inject(ESCROW_RECONCILIATION_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.reconciliationQueue.close(), this.pool.end()])
  }
}
