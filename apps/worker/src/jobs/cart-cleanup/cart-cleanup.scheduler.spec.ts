/**
 * Тест `CartCleanupScheduler` (DTJ-224). Планировщик — тонкая обёртка над BullMQ
 * `Worker`/`Queue`; `bullmq` замокан, чтобы не открывать реальное соединение с Redis
 * (конвенция: без мока конструктор `Worker` начинает слушать очередь по-настоящему,
 * `prune-search-query-log.scheduler.spec.ts`).
 */
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  CART_CLEANUP_CRON,
  CART_CLEANUP_JOB_NAME,
  CART_CLEANUP_SCHEDULER_ID,
  CART_CLEANUP_TZ,
} from './cart-cleanup.constants.js'
import type { CartAbandonedCleanupJob } from './cart-abandoned-cleanup.job.js'
import { CartCleanupScheduler } from './cart-cleanup.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

describe('CartCleanupScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let job: CartAbandonedCleanupJob
  let scheduler: CartCleanupScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = {
      name: 'cart-cleanup',
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue({ registeredDeleted: 0, guestDeleted: 0 })
    job = { runOnce: runOnceMock } as unknown as CartAbandonedCleanupJob
    scheduler = new CartCleanupScheduler(queueMock as unknown as Queue, connection, job)
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

  it('onModuleInit регистрирует cron-расписание с ожидаемыми параметрами (DTJ-224: 05:00 Asia/Dushanbe)', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      CART_CLEANUP_SCHEDULER_ID,
      { pattern: CART_CLEANUP_CRON, tz: CART_CLEANUP_TZ },
      { name: CART_CLEANUP_JOB_NAME },
    )
  })

  it('тик Worker вызывает CartAbandonedCleanupJob.runOnce()', async () => {
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

  it('ошибка upsertJobScheduler логируется, а не проглатывается молча/не падает процесс', async () => {
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
