/**
 * `MockBankAutoPayModule` (EP-10, DTJ-238) — регистрирует BullMQ `Worker`, слушающий очередь
 * `mock-bank-auto-pay` (`QUEUE_NAMES.MOCK_BANK_AUTO_PAY`), и делегирует каждую джобу
 * `MockBankAutoPayJob.process()`. Producer — apps/api (`MockBankProvider`), эта очередь НЕ
 * тикает по расписанию (в отличие от `cart-cleanup`/`outbox-relay`) — джобы появляются
 * ИСКЛЮЧИТЕЛЬНО извне, поэтому здесь нет отдельного `*.scheduler.ts`/`upsertJobScheduler`.
 *
 * `onModuleInit` НЕ `async` (тот же приём, что `CartCleanupScheduler`/`OutboxRelayScheduler`) —
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
import { MockBankAutoPayJob } from './mock-bank-auto-pay.job.js'
import type { MockBankAutoPayJobData } from './mock-bank-auto-pay.types.js'

@Injectable()
class MockBankAutoPayWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MockBankAutoPayWorkerRunner.name)
  private worker: Worker<MockBankAutoPayJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    private readonly job: MockBankAutoPayJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<MockBankAutoPayJobData>(
      QUEUE_NAMES.MOCK_BANK_AUTO_PAY,
      (bullJob: Job<MockBankAutoPayJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `mock-bank-auto-pay: job ${bullJob?.id ?? '?'} (providerRef=${bullJob?.data.providerRef ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<MockBankAutoPayJobData>): Promise<void> {
    await this.job.process(bullJob, {
      apiInternalUrl: this.configService.get('API_INTERNAL_URL', { infer: true }),
      webhookSecret: this.configService.get('MOCK_BANK_WEBHOOK_SECRET', { infer: true }),
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}

@Module({
  providers: [MockBankAutoPayJob, MockBankAutoPayWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class MockBankAutoPayModule {}
