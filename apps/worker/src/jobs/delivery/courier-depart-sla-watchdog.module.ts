// Регистрирует BullMQ Worker для courier-depart-sla-watchdog, 1:1 приём DeliveryOfferTimeoutModule.
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
import { CourierDepartSlaWatchdogJob } from './courier-depart-sla-watchdog.job.js'
import type { CourierDepartSlaWatchdogJobData } from './courier-depart-sla-watchdog.types.js'

@Injectable()
class CourierDepartSlaWatchdogWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CourierDepartSlaWatchdogWorkerRunner.name)
  private worker: Worker<CourierDepartSlaWatchdogJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    private readonly job: CourierDepartSlaWatchdogJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<CourierDepartSlaWatchdogJobData>(
      QUEUE_NAMES.COURIER_DEPART_SLA_WATCHDOG,
      (bullJob: Job<CourierDepartSlaWatchdogJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `courier-depart-sla-watchdog: job ${bullJob?.id ?? '?'} (deliveryAssignmentId=${bullJob?.data.deliveryAssignmentId ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<CourierDepartSlaWatchdogJobData>): Promise<void> {
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
  providers: [CourierDepartSlaWatchdogJob, CourierDepartSlaWatchdogWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: носитель декоратора @Module.
export class CourierDepartSlaWatchdogModule {}
