/**
 * Подписчик `QueueEvents('inventory-sync-queue')` (EP-05, DTJ-155).
 *
 * Регистрируется в `InventorySyncFailedModule` (`OnModuleInit`),
 * подписывается на `failed`-событие и вызывает `handleFailedJob`.
 * При `OnModuleDestroy` — корректно отписывается и закрывает
 * `QueueEvents`-соединение.
 *
 * ВАЖНО: в BullMQ 6.x событие `failed` НЕ содержит `data` (только `jobId`,
 * `failedReason`, `prev`). Чтобы получить `data.batchId`, подписчик
 * лезет в `Job.fromId()` — это стандартный путь для failed-handler'ов.
 * Тонкая настройка `attempts` доступна через `Job.opts.attempts`.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Job, QueueEvents } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- worker-слой имеет доступ к общему Redis-клиенту через DI-токен REDIS_CONNECTION (см. config/redis-connection.provider.ts)
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { InventorySyncFailedJobHandler, type FailedJobDescriptor } from './inventory-sync-failed.handler.js'
import { INVENTORY_SYNC_QUEUE_NAME } from './inventory-sync-failed.constants.js'

@Injectable()
export class InventorySyncFailedListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventorySyncFailedListener.name)
  private queueEvents: QueueEvents | null = null

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly handler: InventorySyncFailedJobHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queueEvents = new QueueEvents(INVENTORY_SYNC_QUEUE_NAME, {
      connection: this.connection,
    })
    // BullMQ 6.x: autorun=true по умолчанию, подписка — стандартный
    // EventEmitter `on('failed', listener)`. Тип `failed` принимает
    // `{ jobId, failedReason, prev? }` (без `data`).
    this.queueEvents.on('failed', ({ jobId, failedReason, prev }) => {
      void this.deliverFromQueue(jobId, failedReason, prev).catch((err: unknown) => {
        this.logger.error(
          { jobId, err: err instanceof Error ? err.message : String(err) },
          'inventory-sync failed handler crashed',
        )
      })
    })
    this.logger.log(`Subscribed to ${INVENTORY_SYNC_QUEUE_NAME} failed events`)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queueEvents !== null) {
      await this.queueEvents.close()
      this.queueEvents = null
    }
  }

  /**
   * Подтягивает `Job` по `jobId` (Job.fromId) и формирует дескриптор
   * для handler'а. Если job уже вычищен из Redis — логирует warn и no-op.
   */
  private async deliverFromQueue(
    jobId: string,
    failedReason: string,
    prev: string | undefined,
  ): Promise<void> {
    const attempts = typeof prev === 'string' ? Number.parseInt(prev, 10) : 0
    let data: Readonly<Record<string, unknown>> = {}
    let optsAttempts = 5
    let attemptsMade = attempts + 1
    try {
      // Job.fromId требует MinimalQueue (не строку). Передаём сам `this.queueEvents` —
      // QueueEvents extends QueueBase, который implements MinimalQueue. Это
      // документированный путь в BullMQ 6.x (см. queue-base.d.ts).
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- queueEvents инициализирован в onModuleInit до on('failed'); здесь мы в обработчике после init.
      const job = await Job.fromId(this.queueEvents!, jobId)
      if (job !== undefined) {
        const rawData = job.data as Readonly<Record<string, unknown>> | undefined
        data = rawData ?? {}
        const opts = job.opts as { attempts?: number }
        optsAttempts = typeof opts.attempts === 'number' ? opts.attempts : 5
        attemptsMade = typeof job.attemptsMade === 'number' ? job.attemptsMade : attemptsMade
      } else {
        this.logger.warn({ jobId }, 'inventory-sync failed: job not found in Redis (likely cleaned up)')
      }
    } catch (err) {
      this.logger.warn(
        { jobId, err: err instanceof Error ? err.message : String(err) },
        'inventory-sync failed: Job.fromId error, falling back to event-only data',
      )
    }
    const descriptor: FailedJobDescriptor = {
      jobId,
      attemptsMade,
      opts: { attempts: optsAttempts },
      failedReason: typeof failedReason === 'string' ? failedReason : 'unknown',
      stacktrace: [],
      data,
    }
    await this.handler.handle(descriptor)
  }
}
