/**
 * Планировщик `cash-commission-aggregation` (DTJ-251). ОДНА BullMQ `Queue`, ДВА независимых
 * `repeat`-расписания (`upsertJobScheduler` дважды, разные `schedulerId`/`name`) — см. JSDoc
 * `cash-commission-aggregation.job.ts` про «тот же файл джобы, второй cron» (буквальный текст
 * тикета «Что сделать» п.3). ОДИН `Worker` дispatch'ит по `job.name` — тот же приём, что любой
 * BullMQ worker с несколькими типами job на одной очереди (штатная возможность библиотеки, не
 * специфика этого тикета).
 *
 * Cron ASSUMPTION (буквальный текст тикета «Технический контекст» — «ежедневно» — и «Что
 * сделать» п.3 — «сегодня воскресенье 23:59 Asia/Dushanbe»): ежедневный тик — `'30 0 * * *'`
 * (00:30, после полуночи Dushanbe — период `[вчера,сегодня)` уже полностью закрыт К МОМЕНТУ
 * запуска, не гонка с ещё продолжающимися `delivered_at`-записями текущих суток); еженедельный
 * issue — `'50 23 * * 0'` (воскресенье 23:50 Dushanbe, ДО полуночи, буквально «23:59» тикета
 * округлено на 10 минут раньше — оставляет запас на выполнение самого тика ДО смены дня недели).
 * Оба — ENV, DoD тикета.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Job, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  CASH_COMMISSION_AGGREGATION_DAILY_CRON,
  CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME,
  CASH_COMMISSION_AGGREGATION_DAILY_SCHEDULER_ID,
  CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN,
  CASH_COMMISSION_AGGREGATION_TZ,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_SCHEDULER_ID,
} from './cash-commission-aggregation.constants.js'
import { CashCommissionAggregationJob } from './cash-commission-aggregation.job.js'

/**
 * Агрегирует `Queue` + ОБА cron-выражения (ENV) в ОДИН инжектируемый параметр — иначе
 * конструктор `CashCommissionAggregationScheduler` нёс бы 5 параметров, нарушая `max-params`
 * ≤3 (C5). Тот же приём, что `ReconciliationScheduleConfig`/`PayoutSchedulerScheduleConfig`.
 */
@Injectable()
export class CashCommissionAggregationScheduleConfig {
  constructor(
    @Inject(CASH_COMMISSION_AGGREGATION_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(CASH_COMMISSION_AGGREGATION_DAILY_CRON) public readonly dailyCron: string,
    @Inject(CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON) public readonly weeklyIssueCron: string,
  ) {}
}

@Injectable()
export class CashCommissionAggregationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CashCommissionAggregationScheduler.name)
  private readonly aggregationQueue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: CashCommissionAggregationScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: CashCommissionAggregationJob,
  ) {
    this.aggregationQueue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.aggregationQueue.name, (bullJob) => this.handleTick(bullJob), { connection: this.connection })
    this.scheduleTicks().catch((error: unknown) => {
      this.logger.error(`cash-commission-aggregation: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTicks(): Promise<void> {
    await this.aggregationQueue.upsertJobScheduler(
      CASH_COMMISSION_AGGREGATION_DAILY_SCHEDULER_ID,
      { pattern: this.schedule.dailyCron, tz: CASH_COMMISSION_AGGREGATION_TZ },
      { name: CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME },
    )
    await this.aggregationQueue.upsertJobScheduler(
      CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_SCHEDULER_ID,
      { pattern: this.schedule.weeklyIssueCron, tz: CASH_COMMISSION_AGGREGATION_TZ },
      { name: CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  /** Dispatch по `job.name` — ОДИН `Worker` обслуживает ОБА расписания этой очереди (см. JSDoc файла). */
  private async handleTick(bullJob: Job): Promise<void> {
    if (bullJob.name === CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME) {
      await this.job.runDailyAggregation()
      return
    }
    if (bullJob.name === CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME) {
      await this.job.runWeeklyIssue()
      return
    }
    this.logger.error(`cash-commission-aggregation: неизвестное имя job'а BullMQ — ${bullJob.name}`)
  }
}
