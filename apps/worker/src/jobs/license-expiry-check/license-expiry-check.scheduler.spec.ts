/**
 * Тест `LicenseExpiryCheckScheduler` (DTJ-073). Планировщик — тонкая обёртка над BullMQ
 * `Worker`/`Queue`; `bullmq` замокан, чтобы не открывать реальное соединение с Redis
 * (конвенция: без мока конструктор `Worker` начинает слушать очередь по-настоящему).
 */
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  LICENSE_EXPIRY_CHECK_CRON,
  LICENSE_EXPIRY_CHECK_JOB_NAME,
  LICENSE_EXPIRY_CHECK_SCHEDULER_ID,
  LICENSE_EXPIRY_CHECK_TZ,
} from './license-expiry-check.constants.js'
import type { LicenseExpiryCheckProcessor } from './license-expiry-check.processor.js'
import { LicenseExpiryCheckScheduler } from './license-expiry-check.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

describe('LicenseExpiryCheckScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let processor: LicenseExpiryCheckProcessor
  let scheduler: LicenseExpiryCheckScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = {
      name: 'license-expiry-check',
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue(2)
    processor = { runOnce: runOnceMock } as unknown as LicenseExpiryCheckProcessor
    scheduler = new LicenseExpiryCheckScheduler(queueMock as unknown as Queue, connection, processor)
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

  it('onModuleInit регистрирует cron-расписание с ожидаемыми параметрами (DTJ-073: 06:00 Asia/Dushanbe)', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      LICENSE_EXPIRY_CHECK_SCHEDULER_ID,
      { pattern: LICENSE_EXPIRY_CHECK_CRON, tz: LICENSE_EXPIRY_CHECK_TZ },
      { name: LICENSE_EXPIRY_CHECK_JOB_NAME },
    )
  })

  it('тик Worker вызывает LicenseExpiryCheckProcessor.runOnce()', async () => {
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
