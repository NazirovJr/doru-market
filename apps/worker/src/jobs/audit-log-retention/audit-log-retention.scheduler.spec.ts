// bullmq замокан — без мока конструктор Worker начинает слушать очередь по-настоящему.
import { Logger } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  AUDIT_LOG_RETENTION_JOB_NAME,
  AUDIT_LOG_RETENTION_SCHEDULER_ID,
  AUDIT_LOG_RETENTION_TZ,
} from './audit-log-retention.constants.js'
import type { AuditLogRetentionJob } from './audit-log-retention.job.js'
import { AuditLogRetentionScheduleConfig, AuditLogRetentionScheduler } from './audit-log-retention.scheduler.js'

const TEST_CRON = '0 3 1 */3 *'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

describe('AuditLogRetentionScheduler', () => {
  let queueMock: { name: string; upsertJobScheduler: Mock }
  let connection: Redis
  let runOnceMock: Mock
  let job: AuditLogRetentionJob
  let scheduler: AuditLogRetentionScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    queueMock = {
      name: 'audit-log-retention',
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }
    connection = {} as Redis
    runOnceMock = vi.fn().mockResolvedValue({ deletedTotal: 0, batches: 0 })
    job = { runOnce: runOnceMock } as unknown as AuditLogRetentionJob
    const schedule = new AuditLogRetentionScheduleConfig(queueMock as unknown as Queue, TEST_CRON)
    scheduler = new AuditLogRetentionScheduler(schedule, connection, job)
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

  it('onModuleInit регистрирует cron-расписание с ожидаемыми параметрами (квартальное, Asia/Dushanbe)', () => {
    scheduler.onModuleInit()

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      AUDIT_LOG_RETENTION_SCHEDULER_ID,
      { pattern: TEST_CRON, tz: AUDIT_LOG_RETENTION_TZ },
      { name: AUDIT_LOG_RETENTION_JOB_NAME },
    )
  })

  it('тик Worker вызывает AuditLogRetentionJob.runOnce()', async () => {
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
