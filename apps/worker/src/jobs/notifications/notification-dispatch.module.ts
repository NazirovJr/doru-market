/**
 * `NotificationDispatchModule` (DTJ-368, EP-16) — регистрирует BullMQ `Worker`, слушающий очередь
 * `notification-dispatch` (`QUEUE_NAMES.NOTIFICATION_DISPATCH`), и делегирует каждую джобу
 * `NotificationDispatchProcessor.process()`. Тот же паттерн, что `MockBankAutoPayModule` (EP-10):
 * очередь наполняется ИЗВНЕ (диспетчер `DTJ-370`, ещё не существует), НЕ тикает по расписанию —
 * поэтому здесь нет `*.scheduler.ts`/`upsertJobScheduler`.
 *
 * `onModuleInit` НЕ `async` (тот же приём, что `MockBankAutoPayModule`/`CartCleanupScheduler`) —
 * недоступный при старте Redis не должен блокировать граф DI / `GET /health`.
 */
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
import { NotificationDispatchProcessor, type NotificationDispatchJobData } from './notification-dispatch.processor.js'

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
      { connection: this.connection },
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
  providers: [NotificationDispatchProcessor, NotificationDispatchWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class NotificationDispatchModule {}
