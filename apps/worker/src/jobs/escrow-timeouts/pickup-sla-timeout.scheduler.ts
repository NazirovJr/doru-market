/**
 * Планировщик `pickup-sla-timeout` (DTJ-254). Регистрирует BullMQ `repeat` job по cron
 * `PICKUP_SLA_TIMEOUT_CRON` (ENV, ASSUMPTION — каждые 2 минуты, ticket «Что сделать» п.1, короче
 * минимального разумного `pickup_sla_minutes`; точное cron-выражение см.
 * `DEFAULT_PICKUP_SLA_TIMEOUT_CRON` в `env.schema.ts`). Зеркало `unpaid-order-timeout.scheduler.ts`
 * (DTJ-253) по структуре — `onModuleInit` НЕ блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  PICKUP_SLA_TIMEOUT_CRON,
  PICKUP_SLA_TIMEOUT_JOB_NAME,
  PICKUP_SLA_TIMEOUT_QUEUE_TOKEN,
  PICKUP_SLA_TIMEOUT_SCHEDULER_ID,
  PICKUP_SLA_TIMEOUT_TZ,
} from './pickup-sla-timeout.constants.js'
import { PickupSlaTimeoutJob } from './pickup-sla-timeout.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `PickupSlaTimeoutScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же приём, что
 * `UnpaidOrderTimeoutScheduleConfig`.
 */
@Injectable()
export class PickupSlaTimeoutScheduleConfig {
  constructor(
    @Inject(PICKUP_SLA_TIMEOUT_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(PICKUP_SLA_TIMEOUT_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class PickupSlaTimeoutScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickupSlaTimeoutScheduler.name)
  private readonly timeoutQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: PickupSlaTimeoutScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: PickupSlaTimeoutJob,
  ) {
    this.timeoutQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.timeoutQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`pickup-sla-timeout: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.timeoutQueue.upsertJobScheduler(
      PICKUP_SLA_TIMEOUT_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: PICKUP_SLA_TIMEOUT_TZ },
      { name: PICKUP_SLA_TIMEOUT_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
