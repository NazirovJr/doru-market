/**
 * `PartialFulfillmentTimeoutModule` (EP-12, DTJ-304) — регистрирует BullMQ `Worker`, слушающий
 * очередь `partial-fulfillment-timeout` (`QUEUE_NAMES.PARTIAL_FULFILLMENT_TIMEOUT`), и
 * делегирует каждую джобу `PartialFulfillmentTimeoutJob.process()`. Producer — apps/api
 * (`PartialFulfillmentTimeoutProcessor`), эта очередь НЕ тикает по расписанию (в отличие от
 * `cart-cleanup`/`outbox-relay`) — джобы появляются ИСКЛЮЧИТЕЛЬНО извне (delayed job на
 * `propose-partial-fulfillment`), поэтому здесь нет отдельного `*.scheduler.ts`. 1:1 приём
 * `MockBankAutoPayModule` (EP-10, DTJ-238).
 *
 * `API_INTERNAL_URL`/`INTERNAL_API_KEY` — ТЕ ЖЕ ENV-переменные, что `system-order-cancel.client.ts`
 * (DTJ-253/254), читаются напрямую через `ConfigService` В `handle()` (не через её общие
 * DI-токены `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN` — те нужны потребителям,
 * инжектящим значение В КОНСТРУКТОР job'ы, как `PickupSlaTimeoutJob`; здесь, как и
 * `MockBankAutoPayJob`, `deps` передаются АРГУМЕНТОМ `process(job, deps)`, токен-обёртка избыточна).
 *
 * `onModuleInit` НЕ `async` (тот же приём, что `MockBankAutoPayModule`/`CartCleanupScheduler`) —
 * недоступный при старте Redis не должен блокировать граф DI / `GET /health`.
 */
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import type { WorkerEnv } from '../../config/env.schema.js'
import { PartialFulfillmentTimeoutJob } from './partial-fulfillment-timeout.job.js'
import type { PartialFulfillmentTimeoutJobData } from './partial-fulfillment-timeout.types.js'

@Injectable()
class PartialFulfillmentTimeoutWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartialFulfillmentTimeoutWorkerRunner.name)
  private worker: Worker<PartialFulfillmentTimeoutJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    private readonly job: PartialFulfillmentTimeoutJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<PartialFulfillmentTimeoutJobData>(
      QUEUE_NAMES.PARTIAL_FULFILLMENT_TIMEOUT,
      (bullJob: Job<PartialFulfillmentTimeoutJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `partial-fulfillment-timeout: job ${bullJob?.id ?? '?'} (requestId=${bullJob?.data.requestId ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<PartialFulfillmentTimeoutJobData>): Promise<void> {
    await this.job.process(bullJob, {
      apiInternalUrl: this.configService.get('API_INTERNAL_URL', { infer: true }),
      internalApiKey: this.configService.get('INTERNAL_API_KEY', { infer: true }),
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}

@Module({
  providers: [PartialFulfillmentTimeoutJob, PartialFulfillmentTimeoutWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class PartialFulfillmentTimeoutModule {}
