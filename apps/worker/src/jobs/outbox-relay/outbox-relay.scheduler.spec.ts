/**
 * Тест `OutboxRelayScheduler`. Планировщик — тонкая обёртка над BullMQ `Worker`/`Queue`;
 * `bullmq` замокан, чтобы не открывать реальное соединение с Redis (конвенция —
 * `cart-cleanup.scheduler.spec.ts`). В отличие от cron-планировщиков этот тикает
 * по интервалу `every`.
 */
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_RELAY_JOB_NAME,
  OUTBOX_RELAY_SCHEDULER_ID,
} from './outbox-relay.constants.js'
import type { OutboxRelayProcessor } from './outbox-relay.processor.js'
import { OutboxRelayScheduler } from './outbox-relay.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

describe('OutboxRelayScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let relayOnceMock: Mock
  let processor: OutboxRelayProcessor
  let scheduler: OutboxRelayScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = { name: 'outbox-relay', upsertJobScheduler: vi.fn().mockResolvedValue(undefined) }
    connection = {} as Redis
    relayOnceMock = vi.fn().mockResolvedValue(3)
    processor = { relayOnce: relayOnceMock } as unknown as OutboxRelayProcessor
    scheduler = new OutboxRelayScheduler(queueMock as unknown as Queue, connection, processor)
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

  it('onModuleInit регистрирует расписание по интервалу, а не по cron', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      OUTBOX_RELAY_SCHEDULER_ID,
      { every: OUTBOX_POLL_INTERVAL_MS },
      { name: OUTBOX_RELAY_JOB_NAME },
    )
  })

  it('тик Worker вызывает OutboxRelayProcessor.relayOnce() и пишет число событий в лог', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    scheduler.onModuleInit()

    const [, tickFn] = (Worker as unknown as Mock).mock.calls[0] as [string, () => Promise<void>]
    await tickFn()

    expect(relayOnceMock).toHaveBeenCalledTimes(1)
    const [message] = logSpy.mock.calls[0] as [string]
    expect(message).toContain('3')
    logSpy.mockRestore()
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
