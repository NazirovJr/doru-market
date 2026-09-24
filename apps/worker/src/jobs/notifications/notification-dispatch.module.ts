/**
 * Регистрирует BullMQ `Worker` очереди `notification-dispatch`. Backoff — custom (не exponential,
 * см. contracts). Limiter — глобальный ≤1/сек (не per-chatId, BullMQ OSS без Pro не умеет per-key).
 * `OutboxToNotificationsConsumer` здесь больше нет — переехал в apps/api (см. отчёт сдачи).
 */
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
import { resolveNotificationDispatchBackoffMs, type NotificationDispatchJobData } from '@dorutj/contracts'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
import { NotificationDispatchProcessor } from './notification-dispatch.processor.js'
import { NOTIFICATION_DISPATCH_QUEUE, NOTIFICATION_DISPATCH_STORE, NOTIFICATIONS_DB_POOL } from './notification-dispatch.constants.js'
import { PgNotificationDispatchStoreAdapter } from './pg-notification-dispatch-store.adapter.js'
import { TELEGRAM_SENDER_PORT } from './telegram-sender.port.js'
import { WorkerTelegramSenderAdapter } from './worker-telegram-sender.js'

const RATE_LIMIT_MAX_JOBS = 1
const RATE_LIMIT_DURATION_MS = 1_000

@Injectable()
class NotificationDispatchWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatchWorkerRunner.name)
  private worker: Worker<NotificationDispatchJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly processor: NotificationDispatchProcessor,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<NotificationDispatchJobData>(
      QUEUE_NAMES.NOTIFICATION_DISPATCH,
      (bullJob: Job<NotificationDispatchJobData>) => this.processor.process(bullJob),
      {
        connection: this.connection,
        limiter: { max: RATE_LIMIT_MAX_JOBS, duration: RATE_LIMIT_DURATION_MS },
        settings: { backoffStrategy: (attemptsMade: number) => resolveNotificationDispatchBackoffMs(attemptsMade) },
      },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(`notification-dispatch: job ${bullJob?.id ?? '?'} failed — ${error.message}`)
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}

@Module({
  providers: [
    {
      provide: NOTIFICATIONS_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: NOTIFICATION_DISPATCH_QUEUE,
      useFactory: (connection: Redis): Queue<NotificationDispatchJobData> =>
        new Queue<NotificationDispatchJobData>(QUEUE_NAMES.NOTIFICATION_DISPATCH, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: NOTIFICATION_DISPATCH_STORE, useClass: PgNotificationDispatchStoreAdapter },
    { provide: TELEGRAM_SENDER_PORT, useClass: WorkerTelegramSenderAdapter },
    NotificationDispatchProcessor,
    NotificationDispatchWorkerRunner,
  ],
})
export class NotificationDispatchModule implements OnModuleDestroy {
  public constructor(
    @Inject(NOTIFICATIONS_DB_POOL) private readonly pool: Pool,
    @Inject(NOTIFICATION_DISPATCH_QUEUE) private readonly dispatchQueue: Queue<NotificationDispatchJobData>,
  ) {}

  public async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pool.end(), this.dispatchQueue.close()])
  }
}
