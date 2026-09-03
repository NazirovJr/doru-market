/**
 * Планировщик `escrow-reconciliation` (DTJ-247). Регистрирует BullMQ `repeat` job по cron
 * `RECONCILIATION_CRON` (ENV, ASSUMPTION `'0 3 * * *'` — 03:00 Asia/Dushanbe, после ночной
 * 1С-синхронизации, не одновременно с ней). Зеркало `cart-cleanup.scheduler.ts`/
 * `license-expiry-check.scheduler.ts` — `onModuleInit` не блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  ESCROW_RECONCILIATION_JOB_NAME,
  ESCROW_RECONCILIATION_QUEUE_TOKEN,
  ESCROW_RECONCILIATION_SCHEDULER_ID,
  ESCROW_RECONCILIATION_TZ,
  RECONCILIATION_CRON,
} from './escrow-reconciliation.constants.js'
import { EscrowReconciliationJob } from './escrow-reconciliation.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `EscrowReconciliationScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же
 * приём, что `EscrowReconciliationPorts` (`escrow-reconciliation.job.ts`) — механическая
 * обвязка DI, без логики.
 */
@Injectable()
export class ReconciliationScheduleConfig {
  constructor(
    @Inject(ESCROW_RECONCILIATION_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(RECONCILIATION_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class EscrowReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscrowReconciliationScheduler.name)
  private readonly reconciliationQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: ReconciliationScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: EscrowReconciliationJob,
  ) {
    this.reconciliationQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.reconciliationQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`escrow-reconciliation: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.reconciliationQueue.upsertJobScheduler(
      ESCROW_RECONCILIATION_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: ESCROW_RECONCILIATION_TZ },
      { name: ESCROW_RECONCILIATION_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
