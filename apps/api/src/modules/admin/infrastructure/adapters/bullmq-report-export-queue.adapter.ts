// jobId = exportJobId — идемпотентный повторный add. Consumer — apps/worker generate-report-export.job.ts.
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import type { ReportExportJobData, ReportExportQueuePort } from '@/modules/admin/application/ports/report-export.port.js'

export const REPORT_EXPORT_QUEUE_NAME = 'report-export'
const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800 },
}

@Injectable()
export class BullmqReportExportQueueAdapter implements ReportExportQueuePort, OnModuleDestroy {

  private readonly queue: Queue<ReportExportJobData>

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<ReportExportJobData>(REPORT_EXPORT_QUEUE_NAME, { connection: redis })
  }

  async enqueue(job: ReportExportJobData): Promise<void> {
    await this.queue.add(REPORT_EXPORT_QUEUE_NAME, job, { ...JOB_OPTIONS, jobId: job.exportJobId })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
