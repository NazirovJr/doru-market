/** DTJ-307 (EP-12) — Worker очереди `picking-sla-watchdog`. Образец — `partial-fulfillment-timeout.module.ts`. */
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
import { PickingSlaWatchdogJob } from './picking-sla-watchdog.job.js'
import type { PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

@Injectable()
class PickingSlaWatchdogWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickingSlaWatchdogWorkerRunner.name)
  private worker: Worker<PickingSlaWatchdogJobData> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(ConfigService) private readonly configService: ConfigService<WorkerEnv, true>,
    @Inject(PickingSlaWatchdogJob) private readonly job: PickingSlaWatchdogJob,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<PickingSlaWatchdogJobData>(
      QUEUE_NAMES.PICKING_SLA_WATCHDOG,
      (bullJob: Job<PickingSlaWatchdogJobData>) => this.handle(bullJob),
      { connection: this.connection },
    )
    this.worker.on('failed', (bullJob, error) => {
      this.logger.error(
        `picking-sla-watchdog: job ${bullJob?.id ?? '?'} (${bullJob?.name ?? '?'}, orderId=${bullJob?.data.orderId ?? '?'}) failed — ${error.message}`,
      )
    })
  }

  private async handle(bullJob: Job<PickingSlaWatchdogJobData>): Promise<void> {
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
  providers: [PickingSlaWatchdogJob, PickingSlaWatchdogWorkerRunner],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class PickingSlaWatchdogModule {}