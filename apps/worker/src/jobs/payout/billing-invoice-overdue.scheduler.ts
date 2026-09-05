/**
 * Планировщик `billing-invoice-overdue` (DTJ-252). Регистрирует BullMQ `repeat` job по cron
 * `BILLING_INVOICE_OVERDUE_CRON` (ENV, ASSUMPTION — «ежедневно», буквальный текст тикета «Что
 * сделать» п.1; точное cron-выражение см. `DEFAULT_BILLING_INVOICE_OVERDUE_CRON` в `env.schema.ts`
 * — не повторено буквально здесь, тот же приём, что WAVE35-CORRECTION в `vitest.integration.
 * config.ts`, чтобы не закрыть JSDoc-блок преждевременно). Зеркало `unpaid-order-timeout.
 * scheduler.ts`/`cash-commission-aggregation.scheduler.ts` по структуре.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  BILLING_INVOICE_OVERDUE_CRON,
  BILLING_INVOICE_OVERDUE_JOB_NAME,
  BILLING_INVOICE_OVERDUE_QUEUE_TOKEN,
  BILLING_INVOICE_OVERDUE_SCHEDULER_ID,
  BILLING_INVOICE_OVERDUE_TZ,
} from './billing-invoice-overdue.constants.js'
import { BillingInvoiceOverdueJob } from './billing-invoice-overdue.job.js'

/**
 * Агрегирует `Queue` + cron-выражение (ENV) в ОДИН инжектируемый параметр — иначе конструктор
 * `BillingInvoiceOverdueScheduler` нёс бы 4 параметра, нарушая `max-params` ≤3 (C5). Тот же
 * приём, что `UnpaidOrderTimeoutScheduleConfig`.
 */
@Injectable()
export class BillingInvoiceOverdueScheduleConfig {
  constructor(
    @Inject(BILLING_INVOICE_OVERDUE_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(BILLING_INVOICE_OVERDUE_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class BillingInvoiceOverdueScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingInvoiceOverdueScheduler.name)
  private readonly overdueQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: BillingInvoiceOverdueScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: BillingInvoiceOverdueJob,
  ) {
    this.overdueQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.overdueQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`billing-invoice-overdue: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.overdueQueue.upsertJobScheduler(
      BILLING_INVOICE_OVERDUE_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: BILLING_INVOICE_OVERDUE_TZ },
      { name: BILLING_INVOICE_OVERDUE_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
