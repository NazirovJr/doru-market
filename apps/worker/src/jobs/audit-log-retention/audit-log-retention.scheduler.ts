import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  AUDIT_LOG_RETENTION_CRON,
  AUDIT_LOG_RETENTION_JOB_NAME,
  AUDIT_LOG_RETENTION_QUEUE_TOKEN,
  AUDIT_LOG_RETENTION_SCHEDULER_ID,
  AUDIT_LOG_RETENTION_TZ,
} from './audit-log-retention.constants.js'
import { AuditLogRetentionJob } from './audit-log-retention.job.js'

// Агрегирует Queue + cron в один параметр — иначе конструктор ниже нёс бы 4 параметра (max-params ≤3).
@Injectable()
export class AuditLogRetentionScheduleConfig {
  constructor(
    @Inject(AUDIT_LOG_RETENTION_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(AUDIT_LOG_RETENTION_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class AuditLogRetentionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogRetentionScheduler.name)
  private readonly retentionQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: AuditLogRetentionScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: AuditLogRetentionJob,
  ) {
    this.retentionQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.retentionQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`audit-log-retention: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.retentionQueue.upsertJobScheduler(
      AUDIT_LOG_RETENTION_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: AUDIT_LOG_RETENTION_TZ },
      { name: AUDIT_LOG_RETENTION_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
