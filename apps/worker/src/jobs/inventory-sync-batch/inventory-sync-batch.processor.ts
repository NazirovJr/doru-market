// Реальный потребитель inventory-sync-queue — пробрасывает исключение в BullMQ на неуспехе HTTP-моста,
// ретраи/финальный провал уже обрабатывают adapter'а очереди и InventorySyncFailedListener (DTJ-153/155).
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { INVENTORY_SYNC_QUEUE_NAME } from '../inventory-sync-failed/inventory-sync-failed.constants.js'
import {
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  requestProcessInventorySyncBatch,
} from './process-inventory-sync-batch.client.js'

interface InventorySyncJobData {
  readonly batchId?: unknown
}

@Injectable()
export class InventorySyncBatchProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventorySyncBatchProcessor.name)
  private worker: Worker | undefined

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<InventorySyncJobData>(
      INVENTORY_SYNC_QUEUE_NAME,
      (job: Job<InventorySyncJobData>) => this.handleJob(job),
      { connection: this.connection },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleJob(job: Job<InventorySyncJobData>): Promise<void> {
    const batchId = job.data.batchId
    if (typeof batchId !== 'string') {
      this.logger.error({ jobId: job.id, data: job.data }, 'inventory-sync-batch: job.data.batchId is not a string')
      return
    }
    await requestProcessInventorySyncBatch(
      { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey },
      batchId,
    )
  }
}
