/**
 * Тест `PickupSlaTimeoutScheduler` (DTJ-254). Планировщик — тонкая обёртка над BullMQ `Worker`/`Queue`;
 * `bullmq` замокан, чтобы не открывать реальное соединение с Redis (конвенция —
 * `cart-cleanup.scheduler.spec.ts`).
 */
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PICKUP_SLA_TIMEOUT_JOB_NAME, PICKUP_SLA_TIMEOUT_SCHEDULER_ID, PICKUP_SLA_TIMEOUT_TZ } from './pickup-sla-timeout.constants.js'
import type { PickupSlaTimeoutJob } from './pickup-sla-timeout.job.js'
import { PickupSlaTimeoutScheduler, type PickupSlaTimeoutScheduleConfig } from './pickup-sla-timeout.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

/** Cron приходит из ENV через конфиг-агрегат, поэтому в тесте он свой. */
const CRON = '*/5 * * * *'

describe('PickupSlaTimeoutScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let job: PickupSlaTimeoutJob
  let scheduler: PickupSlaTimeoutScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = { name: 'pickup-sla-timeout', upsertJobScheduler: vi.fn().mockResolvedValue(undefined) }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue(undefined)
    job = { runOnce: runOnceMock } as unknown as PickupSlaTimeoutJob
    const schedule = { queue: queueMock as unknown as Queue, cron: CRON } as PickupSlaTimeoutScheduleConfig
    scheduler = new PickupSlaTimeoutScheduler(schedule, connection, job)
  })

  it('onModuleInit создаёт Worker на имени очереди с общим Redis-соединением', () => {
    scheduler.onModuleInit()

    expect(Worker).toHaveBeenCalledTimes(1)
    const [queueName, , opts] = (Worker as unknown as Mock).mock.calls[0] as [
      string,
      () => Promise<void>,
      { connection: Redis },
    ]
    expect(queueName).toBe(queueMock.name)
    expect(opts.connection).toBe(connection)
  })

  it('onModuleInit регистрирует расписание с cron из конфига и ожидаемыми идентификаторами', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      PICKUP_SLA_TIMEOUT_SCHEDULER_ID,
      { pattern: CRON, tz: PICKUP_SLA_TIMEOUT_TZ },
      { name: PICKUP_SLA_TIMEOUT_JOB_NAME },
    )
  })

  it('тик Worker вызывает PickupSlaTimeoutJob.runOnce()', async () => {
    scheduler.onModuleInit()

    const [, tickFn] = (Worker as unknown as Mock).mock.calls[0] as [string, () => Promise<void>]
    await tickFn()

    expect(runOnceMock).toHaveBeenCalledTimes(1)
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
