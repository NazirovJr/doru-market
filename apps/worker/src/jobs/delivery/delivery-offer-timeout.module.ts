// Регистрирует BullMQ Worker для delivery-offer-timeout, 1:1 приём PartialFulfillmentTimeoutModule.
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме.
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме.
import type { WorkerEnv } from '../../config/env.schema.js'
import { DeliveryOfferTimeoutJob } from './delivery-offer-timeout.job.js'
import type { DeliveryOfferTimeoutJobData } from './delivery-offer-timeout.types.js'

@Injectable()
class DeliveryOfferTimeoutWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryOfferTimeoutWorkerRunner.name)
  private worker: Worker<DeliveryOfferTimeoutJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    private readonly job: DeliveryOfferTimeoutJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<DeliveryOfferTimeoutJobData>(
      QUEUE_NAMES.DELIVERY_OFFER_TIMEOUT,
      (bullJob: Job<DeliveryOfferTimeoutJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `delivery-offer-timeout: job ${bullJob?.id ?? '?'} (offerId=${bullJob?.data.offerId ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<DeliveryOfferTimeoutJobData>): Promise<void> {
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
  providers: [DeliveryOfferTimeoutJob, DeliveryOfferTimeoutWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: носитель декоратора @Module.
export class DeliveryOfferTimeoutModule {}
