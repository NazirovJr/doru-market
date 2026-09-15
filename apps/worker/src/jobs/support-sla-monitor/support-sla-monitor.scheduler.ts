/**
 * Планировщик `support-sla-monitor` (DTJ-280). Регистрирует BullMQ `repeat` job по cron
 * `SUPPORT_SLA_MONITOR_CRON` (ENV, ASSUMPTION — каждые 5 минут, ticket «Что сделать» п.4; точное
 * cron-выражение см. `DEFAULT_SUPPORT_SLA_MONITOR_CRON` в `env.schema.ts`). Зеркало
 * `pickup-sla-timeout.scheduler.ts` (DTJ-254) по структуре — `onModuleInit` НЕ блокирует граф DI.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  SUPPORT_SLA_MONITOR_CRON,
  SUPPORT_SLA_MONITOR_JOB_NAME,
  SUPPORT_SLA_MONITOR_QUEUE_TOKEN,
  SUPPORT_SLA_MONITOR_SCHEDULER_ID,
  SUPPORT_SLA_MONITOR_TZ,
} from './support-sla-monitor.constants.js'
import { SupportSlaMonitorJob } from './support-sla-monitor.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `SupportSlaMonitorScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же приём, что
 * `PickupSlaTimeoutScheduleConfig`.
 */
@Injectable()
export class SupportSlaMonitorScheduleConfig {
  constructor(
    @Inject(SUPPORT_SLA_MONITOR_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(SUPPORT_SLA_MONITOR_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class SupportSlaMonitorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportSlaMonitorScheduler.name)
  private readonly monitorQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: SupportSlaMonitorScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: SupportSlaMonitorJob,
  ) {
    this.monitorQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.monitorQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`support-sla-monitor: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.monitorQueue.upsertJobScheduler(
      SUPPORT_SLA_MONITOR_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: SUPPORT_SLA_MONITOR_TZ },
      { name: SUPPORT_SLA_MONITOR_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
