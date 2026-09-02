/**
 * Тест `PruneSearchQueryLogScheduler` (DTJ-181). Планировщик — тонкая обёртка над BullMQ
 * `Worker`/`Queue`; `bullmq` замокан, чтобы не открывать реальное соединение с Redis
 * (конвенция: без мока конструктор `Worker` начинает слушать очередь по-настоящему).
 */
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  PRUNE_SEARCH_QUERY_LOG_CRON,
  PRUNE_SEARCH_QUERY_LOG_JOB_NAME,
  PRUNE_SEARCH_QUERY_LOG_SCHEDULER_ID,
  PRUNE_SEARCH_QUERY_LOG_TZ,
} from './prune-search-query-log.constants.js'
import type { PruneSearchQueryLogProcessor } from './prune-search-query-log.processor.js'
import { PruneSearchQueryLogScheduler } from './prune-search-query-log.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

describe('PruneSearchQueryLogScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let processor: PruneSearchQueryLogProcessor
  let scheduler: PruneSearchQueryLogScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = {
      name: 'prune-search-query-log',
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue(7)
    processor = { runOnce: runOnceMock } as unknown as PruneSearchQueryLogProcessor
    scheduler = new PruneSearchQueryLogScheduler(queueMock as unknown as Queue, connection, processor)
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

  it('onModuleInit регистрирует cron-расписание с ожидаемыми параметрами (DTJ-181: 04:30 Asia/Dushanbe)', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      PRUNE_SEARCH_QUERY_LOG_SCHEDULER_ID,
      { pattern: PRUNE_SEARCH_QUERY_LOG_CRON, tz: PRUNE_SEARCH_QUERY_LOG_TZ },
      { name: PRUNE_SEARCH_QUERY_LOG_JOB_NAME },
    )
  })

  it('тик Worker вызывает PruneSearchQueryLogProcessor.runOnce()', async () => {
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
  })
})
