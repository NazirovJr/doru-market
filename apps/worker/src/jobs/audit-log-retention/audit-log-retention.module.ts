// AUDIT_RETENTION_DATABASE_URL опционален: без него используется NullAuditLogRetentionAdapter,
// не PgAuditLogRetentionAdapter под app_role/DATABASE_URL — не ломает boot остального apps/worker
// у исполнителей, у которых эта переменная ещё не настроена.
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  AUDIT_LOG_RETENTION_BATCH_SIZE,
  AUDIT_LOG_RETENTION_CRON,
  AUDIT_LOG_RETENTION_DB_POOL,
  AUDIT_LOG_RETENTION_PORT,
  AUDIT_LOG_RETENTION_QUEUE,
  AUDIT_LOG_RETENTION_QUEUE_TOKEN,
  AUDIT_LOG_RETENTION_YEARS,
} from './audit-log-retention.constants.js'
import { AuditLogRetentionJob } from './audit-log-retention.job.js'
import type { AuditLogRetentionPort } from './audit-log-retention.port.js'
import { AuditLogRetentionScheduleConfig, AuditLogRetentionScheduler } from './audit-log-retention.scheduler.js'
import { NullAuditLogRetentionAdapter } from './null-audit-log-retention.adapter.js'
import { PgAuditLogRetentionAdapter } from './pg-audit-log-retention.adapter.js'

@Module({
  providers: [
    {
      provide: AUDIT_LOG_RETENTION_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool | undefined => {
        const connectionString = configService.get('AUDIT_RETENTION_DATABASE_URL', { infer: true })
        return connectionString === undefined ? undefined : new Pool({ connectionString })
      },
      inject: [ConfigService],
    },
    {
      provide: AUDIT_LOG_RETENTION_YEARS,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('AUDIT_LOG_RETENTION_YEARS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: AUDIT_LOG_RETENTION_BATCH_SIZE,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('AUDIT_LOG_RETENTION_BATCH_SIZE', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: AUDIT_LOG_RETENTION_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('AUDIT_LOG_RETENTION_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: AUDIT_LOG_RETENTION_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(AUDIT_LOG_RETENTION_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    {
      provide: AUDIT_LOG_RETENTION_PORT,
      useFactory: (pool: Pool | undefined): AuditLogRetentionPort =>
        pool === undefined ? new NullAuditLogRetentionAdapter() : new PgAuditLogRetentionAdapter(pool),
      inject: [AUDIT_LOG_RETENTION_DB_POOL],
    },
    AuditLogRetentionJob,
    AuditLogRetentionScheduleConfig,
    AuditLogRetentionScheduler,
  ],
})
export class AuditLogRetentionModule implements OnModuleDestroy {
  constructor(
    @Inject(AUDIT_LOG_RETENTION_QUEUE_TOKEN) private readonly retentionQueue: Queue,
    @Inject(AUDIT_LOG_RETENTION_DB_POOL) private readonly pool: Pool | undefined,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.retentionQueue.close(), this.pool?.end() ?? Promise.resolve()])
  }
}
