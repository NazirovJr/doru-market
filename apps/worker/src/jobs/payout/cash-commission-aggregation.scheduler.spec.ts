/**
 * Тест `CashCommissionAggregationScheduler`. Планировщик — тонкая обёртка над BullMQ
 * `Worker`/`Queue`; `bullmq` замокан, чтобы не открывать реальное соединение с Redis
 * (конвенция — `cart-cleanup.scheduler.spec.ts`). Отличие от соседей: две записи в
 * расписании и разбор имени джоба в тике.
 */
import { Logger } from '@nestjs/common'
import { Worker, type Job, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME,
  CASH_COMMISSION_AGGREGATION_DAILY_SCHEDULER_ID,
  CASH_COMMISSION_AGGREGATION_TZ,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME,
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_SCHEDULER_ID,
} from './cash-commission-aggregation.constants.js'
import type { CashCommissionAggregationJob } from './cash-commission-aggregation.job.js'
import {
  CashCommissionAggregationScheduler,
  type CashCommissionAggregationScheduleConfig,
} from './cash-commission-aggregation.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

/** Оба cron приходят из ENV через конфиг-агрегат, поэтому в тесте они свои. */
const DAILY_CRON = '0 3 * * *'
const WEEKLY_CRON = '0 4 * * 1'

function tickWith(name: string): Job {
  return { name } as Job
}

describe('CashCommissionAggregationScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runDailyMock: Mock
  let runWeeklyMock: Mock
  let job: CashCommissionAggregationJob
  let scheduler: CashCommissionAggregationScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = { name: 'cash-commission-aggregation', upsertJobScheduler: vi.fn().mockResolvedValue(undefined) }
    connection = {} as Redis
    runDailyMock = vi.fn().mockResolvedValue(undefined)
    runWeeklyMock = vi.fn().mockResolvedValue(undefined)
    job = { runDailyAggregation: runDailyMock, runWeeklyIssue: runWeeklyMock } as unknown as CashCommissionAggregationJob
    const schedule = {
      queue: queueMock as unknown as Queue,
      dailyCron: DAILY_CRON,
      weeklyIssueCron: WEEKLY_CRON,
    } as CashCommissionAggregationScheduleConfig
    scheduler = new CashCommissionAggregationScheduler(schedule, connection, job)
  })

  it('onModuleInit создаёт Worker на имени очереди с общим Redis-соединением', () => {
    scheduler.onModuleInit()

    expect(Worker).toHaveBeenCalledTimes(1)
    const [queueName, , opts] = (Worker as unknown as Mock).mock.calls[0] as [
      string,
      (bullJob: Job) => Promise<void>,
      { connection: Redis },
    ]
    expect(queueName).toBe(queueMock.name)
    expect(opts.connection).toBe(connection)
  })

  it('onModuleInit регистрирует оба расписания — дневное и недельное', async () => {
    scheduler.onModuleInit()
    await vi.waitFor(() => {
      expect(queueMock.upsertJobScheduler).toHaveBeenCalledTimes(2)
    })

    expect(queueMock.upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      CASH_COMMISSION_AGGREGATION_DAILY_SCHEDULER_ID,
      { pattern: DAILY_CRON, tz: CASH_COMMISSION_AGGREGATION_TZ },
      { name: CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME },
    )
    expect(queueMock.upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_SCHEDULER_ID,
      { pattern: WEEKLY_CRON, tz: CASH_COMMISSION_AGGREGATION_TZ },
      { name: CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME },
    )
  })

  it('дневной тик вызывает runDailyAggregation(), недельный не трогает', async () => {
    scheduler.onModuleInit()

    const [, tickFn] = (Worker as unknown as Mock).mock.calls[0] as [string, (bullJob: Job) => Promise<void>]
    await tickFn(tickWith(CASH_COMMISSION_AGGREGATION_DAILY_JOB_NAME))

    expect(runDailyMock).toHaveBeenCalledTimes(1)
    expect(runWeeklyMock).not.toHaveBeenCalled()
  })

  it('недельный тик вызывает runWeeklyIssue(), дневной не трогает', async () => {
    scheduler.onModuleInit()

    const [, tickFn] = (Worker as unknown as Mock).mock.calls[0] as [string, (bullJob: Job) => Promise<void>]
    await tickFn(tickWith(CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_JOB_NAME))

    expect(runWeeklyMock).toHaveBeenCalledTimes(1)
    expect(runDailyMock).not.toHaveBeenCalled()
  })

  it('неизвестное имя джоба — ошибка в лог, ни один прогон не запускается', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    scheduler.onModuleInit()

    const [, tickFn] = (Worker as unknown as Mock).mock.calls[0] as [string, (bullJob: Job) => Promise<void>]
    await tickFn(tickWith('weird'))

    expect(runDailyMock).not.toHaveBeenCalled()
    expect(runWeeklyMock).not.toHaveBeenCalled()
    const [message] = errorSpy.mock.calls[0] as [string]
    expect(message).toContain('weird')
    errorSpy.mockRestore()
  })

  it('onModuleDestroy закрывает Worker, созданный в onModuleInit', async () => {
    scheduler.onModuleInit()

    await scheduler.onModuleDestroy()

    expect(fakeWorkerClose).toHaveBeenCalledTimes(1)
  })

  it('onModuleDestroy без предварительного onModuleInit — no-op, не падает', async () => {
    await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined()
    expect(fakeWorkerClose).not.toHaveBeenCalled()
  })

  it('ошибка upsertJobScheduler логируется, а не роняет граф DI', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    queueMock.upsertJobScheduler.mockRejectedValue(new Error('redis unavailable'))

    scheduler.onModuleInit()
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(1)
    })

    const [message] = errorSpy.mock.calls[0] as [string]
    expect(message).toContain('redis unavailable')
    errorSpy.mockRestore()
  })
})
