/**
 * Планировщик `payout-scheduler` (DTJ-249). Регистрирует BullMQ `repeat` job по cron
 * `PAYOUT_SCHEDULER_CRON` (ENV, ASSUMPTION `'0 * * * *'` — ежечасно, ticket «Технический
 * контекст»). Зеркало `escrow-reconciliation.scheduler.ts`/`unpaid-order-timeout.scheduler.ts`
 * по структуре — `onModuleInit` не блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  PAYOUT_SCHEDULER_CRON,
  PAYOUT_SCHEDULER_JOB_NAME,
  PAYOUT_SCHEDULER_QUEUE_TOKEN,
  PAYOUT_SCHEDULER_SCHEDULER_ID,
  PAYOUT_SCHEDULER_TZ,
} from './payout-scheduler.constants.js'
import { PayoutSchedulerJob } from './payout-scheduler.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `PayoutSchedulerScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же приём,
 * что `ReconciliationScheduleConfig`/`UnpaidOrderTimeoutScheduleConfig`.
 */
@Injectable()
export class PayoutSchedulerScheduleConfig {
  constructor(
    @Inject(PAYOUT_SCHEDULER_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(PAYOUT_SCHEDULER_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class PayoutSchedulerScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutSchedulerScheduler.name)
  private readonly schedulerQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: PayoutSchedulerScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: PayoutSchedulerJob,
  ) {
    this.schedulerQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.schedulerQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`payout-scheduler: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.schedulerQueue.upsertJobScheduler(
      PAYOUT_SCHEDULER_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: PAYOUT_SCHEDULER_TZ },
      { name: PAYOUT_SCHEDULER_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
