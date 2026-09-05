/**
 * Планировщик `unpaid-order-timeout` (DTJ-253). Регистрирует BullMQ `repeat` job по cron
 * `UNPAID_ORDER_TIMEOUT_CRON` (ENV, ASSUMPTION — каждые 2 минуты, ticket «Что сделать» п.2;
 * точное cron-выражение см. `DEFAULT_UNPAID_ORDER_TIMEOUT_CRON` в `env.schema.ts` — не
 * повторено буквально здесь, чтобы не закрыть этот же JSDoc-блок преждевременно, тот же баг
 * класс, что WAVE35-CORRECTION в `vitest.integration.config.ts`). Зеркало
 * `escrow-reconciliation.scheduler.ts` (DTJ-247) по структуре — `onModuleInit` НЕ блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  UNPAID_ORDER_TIMEOUT_CRON,
  UNPAID_ORDER_TIMEOUT_JOB_NAME,
  UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN,
  UNPAID_ORDER_TIMEOUT_SCHEDULER_ID,
  UNPAID_ORDER_TIMEOUT_TZ,
} from './unpaid-order-timeout.constants.js'
import { UnpaidOrderTimeoutJob } from './unpaid-order-timeout.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `UnpaidOrderTimeoutScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же
 * приём, что `ReconciliationScheduleConfig` (`escrow-reconciliation.scheduler.ts`).
 */
@Injectable()
export class UnpaidOrderTimeoutScheduleConfig {
  constructor(
    @Inject(UNPAID_ORDER_TIMEOUT_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(UNPAID_ORDER_TIMEOUT_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class UnpaidOrderTimeoutScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnpaidOrderTimeoutScheduler.name)
  private readonly timeoutQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: UnpaidOrderTimeoutScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: UnpaidOrderTimeoutJob,
  ) {
    this.timeoutQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.timeoutQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`unpaid-order-timeout: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.timeoutQueue.upsertJobScheduler(
      UNPAID_ORDER_TIMEOUT_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: UNPAID_ORDER_TIMEOUT_TZ },
      { name: UNPAID_ORDER_TIMEOUT_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
