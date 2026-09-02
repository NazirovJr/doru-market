/**
 * BullMQ-реализация `InventorySyncQueuePort` (EP-05, DTJ-153).
 *
 * Подписчик `OutboxRelayWorker` (DTJ-016 follow-up) вызывает
 * `enqueue(...)` для каждого `InventoryBatchQueuedEvent` (через
 * `OUTBOX_EVENT_HANDLERS`-реестр EP-01, контракт будет зафиксирован в
 * DTJ-016 follow-up). Сейчас — точка интеграции объявлена, адаптер
 * готов принимать вызовы.
 *
 * `Queue('inventory-sync-queue')` — переиспользует общий `REDIS_CLIENT`
 * (DTJ-053), не создаёт параллельного пула.
 *
 * Приоритеты: `resolveInventorySyncJobPriority(channel, syncType)` —
 * `rest_api`/`manual_entry` + `delta` = 1, `excel_import` + `delta` = 5,
 * ЛЮБОЙ `full` = 10 (SRS-INV-034).
 *
 * Retry: 5 attempts, exponential 5s (SRS-INV-035; задаётся при
 * постановке, обработка исчерпания — DTJ-155).
 */
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  type InventorySyncJobData,
  type InventorySyncQueuePort,
  resolveInventorySyncJobPriority,
} from '@/modules/inventory/application/ports/inventory-sync-queue.port.js'

const QUEUE_NAME = 'inventory-sync-queue'
const JOB_OPTIONS: Omit<JobsOptions, 'priority'> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800 },
}

@Injectable()
export class BullmqInventorySyncQueueAdapter implements InventorySyncQueuePort, OnModuleDestroy {
   
  private readonly queue: Queue<InventorySyncJobData>

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<InventorySyncJobData>(QUEUE_NAME, {
      connection: redis,
    })
  }

  async enqueue(job: InventorySyncJobData): Promise<void> {
    const priority = resolveInventorySyncJobPriority(job.channel, job.syncType)
    await this.queue.add(QUEUE_NAME, job, {
      ...JOB_OPTIONS,
      // `jobId = batchId` (SRS-INV-032) — дедупликация при
      // at-least-once доставке outbox. Повторный `add` с тем же
      // `jobId` отбрасывается BullMQ.
      jobId: job.batchId,
      priority,
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
