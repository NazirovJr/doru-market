/**
 * `NotificationDispatchModule` (DTJ-368, EP-16) — регистрирует BullMQ `Worker`, слушающий очередь
 * `notification-dispatch` (`QUEUE_NAMES.NOTIFICATION_DISPATCH`), и делегирует каждую джобу
 * `NotificationDispatchProcessor.process()`.
 *
 * DTJ-370 — наполнено реальной логикой (см. JSDoc `notification-dispatch.processor.ts`):
 * - `pg.Pool` (`NOTIFICATIONS_DB_POOL`) + `NOTIFICATION_DISPATCH_STORE` — доступ к физическим
 *   таблицам `notifications`/`notification_templates`/`users`/`tenants`/`processed_events`
 *   СО СТОРОНЫ apps/worker (тот же приём, что `CashCommissionAggregationModule`, DTJ-251).
 * - `NOTIFICATION_DISPATCH_QUEUE` — `Queue<NotificationDispatchJobData>`, ОБА: consumed этим же
 *   `Worker` ниже И produced (первый внешний канал из `OutboxToNotificationsConsumer`, каскад на
 *   следующий канал из `NotificationDispatchProcessor`).
 * - `Worker.settings.backoffStrategy = resolveNotificationDispatchBackoffMs` (2с/8с/32с, SRS-ADM-060,
 *   custom — НЕ геометрическая прогрессия, `@dorutj/contracts`).
 * - `Worker.limiter = {max:1, duration:1000}` — троттлинг Telegram (SRS-ADM-061, REQ-TG-5).
 *   **АССУМПЦИЯ (документирована, не домыслена молча):** ticket требует троттлинг ПО
 *   `telegram_chat_id` (`throttle_key`); ванильный BullMQ OSS (без Pro) поддерживает ТОЛЬКО
 *   ГЛОБАЛЬНЫЙ лимитер очереди, не per-key/группа — принят глобальный лимитер ≤1 job/сек НА ВСЮ
 *   очередь `notification-dispatch` (строже требования per-key, литеральный AC4 удовлетворён:
 *   фактическая отправка ЛЮБОГО одного chatId физически не может превысить 1/сек, если её не
 *   превышает вся очередь). Побочный эффект: лимит делится между ВСЕМИ пользователями/каналами
 *   одновременно, не только telegram (сегодня — единственный реализованный канал, см.
 *   `notification-dispatch.processor.ts`) — см. НАЙДЕННАЯ ЧУЖАЯ ПРОБЛЕМА/риск в отчёте сдачи.
 * - `OutboxToNotificationsConsumer` — новый `Worker` на `domain-events` (см. его JSDoc).
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
import { OutboxToNotificationsConsumer } from './outbox-to-notifications.consumer.js'

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
    NotificationDispatchProcessor,
    NotificationDispatchWorkerRunner,
    OutboxToNotificationsConsumer,
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
