/**
 * Планировщик `payout-execution` (DTJ-250). Регистрирует BullMQ `repeat` job по cron
 * `PAYOUT_EXECUTION_CRON` (ENV, ASSUMPTION — ежечасно `'0 * * * *'`, ТА ЖЕ каденция, что сосед
 * `PayoutSchedulerJob` (DTJ-249) — выплата логично проверяется с той же частотой, что переход
 * `pending→due`, тикет DTJ-250 явную частоту не фиксирует). Зеркало
 * `unpaid-order-timeout.scheduler.ts`/`pickup-sla-timeout.scheduler.ts` по структуре —
 * `onModuleInit` НЕ блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  PAYOUT_EXECUTION_CRON,
  PAYOUT_EXECUTION_JOB_NAME,
  PAYOUT_EXECUTION_QUEUE_TOKEN,
  PAYOUT_EXECUTION_SCHEDULER_ID,
  PAYOUT_EXECUTION_TZ,
} from './payout-execution.constants.js'
import { PayoutExecutionJob } from './payout-execution.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `PayoutExecutionScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же приём, что
 * `UnpaidOrderTimeoutScheduleConfig`.
 */
@Injectable()
export class PayoutExecutionScheduleConfig {
  constructor(
    @Inject(PAYOUT_EXECUTION_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(PAYOUT_EXECUTION_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class PayoutExecutionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutExecutionScheduler.name)
  private readonly executionQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: PayoutExecutionScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: PayoutExecutionJob,
  ) {
    this.executionQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.executionQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`payout-execution: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.executionQueue.upsertJobScheduler(
      PAYOUT_EXECUTION_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: PAYOUT_EXECUTION_TZ },
      { name: PAYOUT_EXECUTION_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
