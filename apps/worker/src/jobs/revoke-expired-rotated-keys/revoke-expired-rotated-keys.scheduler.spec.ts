import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  REVOKE_EXPIRED_ROTATED_KEYS_JOB_NAME,
  REVOKE_EXPIRED_ROTATED_KEYS_SCHEDULER_ID,
  REVOKE_EXPIRED_ROTATED_KEYS_TZ,
} from './revoke-expired-rotated-keys.constants.js'
import type { RevokeExpiredRotatedKeysJob } from './revoke-expired-rotated-keys.job.js'
import { RevokeExpiredRotatedKeysScheduler, type RevokeExpiredRotatedKeysScheduleConfig } from './revoke-expired-rotated-keys.scheduler.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

const CRON = '0 * * * *'

describe('RevokeExpiredRotatedKeysScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let job: RevokeExpiredRotatedKeysJob
  let scheduler: RevokeExpiredRotatedKeysScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = { name: 'revoke-expired-rotated-keys', upsertJobScheduler: vi.fn().mockResolvedValue(undefined) }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue(undefined)
    job = { runOnce: runOnceMock } as unknown as RevokeExpiredRotatedKeysJob
    const schedule = { queue: queueMock as unknown as Queue, cron: CRON } as RevokeExpiredRotatedKeysScheduleConfig
    scheduler = new RevokeExpiredRotatedKeysScheduler(schedule, connection, job)
  })

  it('onModuleInit создаёт Worker на имени очереди с общим Redis-соединением', () => {
    scheduler.onModuleInit()

    expect(Worker).toHaveBeenCalledTimes(1)
    const [queueName, , opts] = (Worker as unknown as Mock).mock.calls[0] as [string, () => Promise<void>, { connection: Redis }]
    expect(queueName).toBe(queueMock.name)
    expect(opts.connection).toBe(connection)
  })

  it('onModuleInit регистрирует расписание с cron из конфига и ожидаемыми идентификаторами', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      REVOKE_EXPIRED_ROTATED_KEYS_SCHEDULER_ID,
      { pattern: CRON, tz: REVOKE_EXPIRED_ROTATED_KEYS_TZ },
      { name: REVOKE_EXPIRED_ROTATED_KEYS_JOB_NAME },
    )
  })

  it('тик Worker вызывает RevokeExpiredRotatedKeysJob.runOnce()', async () => {
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
