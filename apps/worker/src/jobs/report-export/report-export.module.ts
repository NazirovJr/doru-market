/** Регистрирует BullMQ `Worker` очереди `report-export` (EP-15, DTJ-361) — 1:1 приём `NotificationDispatchModule`. */
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
import type { ReportExportJobData } from '@dorutj/contracts'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
import { GenerateReportExportJob } from './generate-report-export.job.js'
import { REPORT_EXPORT_DATA_BUILDER, REPORT_EXPORT_DB_POOL, REPORT_EXPORT_STORE } from './report-export.constants.js'
import { PgReportExportStoreAdapter } from './pg-report-export-store.adapter.js'
import { NullReportExportDataBuilder } from './null-report-export-data-builder.adapter.js'

@Injectable()
class ReportExportWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportExportWorkerRunner.name)
  private worker: Worker<ReportExportJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(GenerateReportExportJob) private readonly job: GenerateReportExportJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<ReportExportJobData>(
      QUEUE_NAMES.REPORT_EXPORT,
      (bullJob: Job<ReportExportJobData>) => this.job.process(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(`report-export: job ${bullJob?.id ?? '?'} failed — ${error.message}`)
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}

@Module({
  providers: [
    {
      provide: REPORT_EXPORT_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    { provide: REPORT_EXPORT_STORE, useClass: PgReportExportStoreAdapter },
    { provide: REPORT_EXPORT_DATA_BUILDER, useClass: NullReportExportDataBuilder },
    GenerateReportExportJob,
    ReportExportWorkerRunner,
  ],
})
export class ReportExportModule implements OnModuleDestroy {
  public constructor(@Inject(REPORT_EXPORT_DB_POOL) private readonly pool: Pool) {}

  public async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
