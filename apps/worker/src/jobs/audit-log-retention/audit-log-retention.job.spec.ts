// Порт замокан — SQL-корректность фильтрации проверяется отдельно интеграционным тестом адаптера.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY } from '@dorutj/contracts'
import { AuditLogRetentionJob } from './audit-log-retention.job.js'
import type { AuditLogRetentionCriteria, AuditLogRetentionPort } from './audit-log-retention.port.js'

const FIXED_NOW = new Date('2026-09-25T03:00:00.000Z')
const RETENTION_YEARS = 5
const BATCH_SIZE = 1000

describe('AuditLogRetentionJob', () => {
  // Отдельная переменная — @typescript-eslint/unbound-method при ссылке на метод порта напрямую.
  let deleteBatchMock: Mock<AuditLogRetentionPort['deleteBatch']>
  let job: AuditLogRetentionJob

  beforeEach(() => {
    deleteBatchMock = vi.fn()
    const retention: AuditLogRetentionPort = { deleteBatch: deleteBatchMock }
    job = new AuditLogRetentionJob(retention, RETENTION_YEARS, BATCH_SIZE)
  })

  it('cutoff вычисляется детерминированно от переданного `now`, БЕЗ реального времени', async () => {
    deleteBatchMock.mockResolvedValue(0)

    await job.runOnce(FIXED_NOW)

    expect(deleteBatchMock).toHaveBeenCalledTimes(1)
    const [criteria] = deleteBatchMock.mock.calls[0] as [AuditLogRetentionCriteria]
    expect(criteria.cutoff.toISOString()).toBe('2021-09-25T03:00:00.000Z') // FIXED_NOW - 5 лет
  })

  it('AC2: категория prescription_access передана как ИСКЛЮЧЁННАЯ на КАЖДЫЙ вызов — безусловно', async () => {
    deleteBatchMock.mockResolvedValueOnce(BATCH_SIZE).mockResolvedValueOnce(0)

    await job.runOnce(FIXED_NOW)

    for (const [criteria] of deleteBatchMock.mock.calls) {
      expect(criteria.excludedCategory).toBe('prescription_access')
      expect(criteria.excludedCategory).toBe(AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY)
    }
  })

  it('AC3: батчинг — репозиторий вызывается N раз для N батчей, не один гигантский DELETE', async () => {
    deleteBatchMock
      .mockResolvedValueOnce(BATCH_SIZE)
      .mockResolvedValueOnce(BATCH_SIZE)
      .mockResolvedValueOnce(BATCH_SIZE)
      .mockResolvedValueOnce(450) // последний неполный батч — сигнал остановки цикла

    const result = await job.runOnce(FIXED_NOW)

    expect(deleteBatchMock).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ deletedTotal: 3 * BATCH_SIZE + 450, batches: 4 })
  })

  it('нечего удалять — 0 батчей, ровно один (пустой) вызов порта, без ошибки', async () => {
    deleteBatchMock.mockResolvedValue(0)

    const result = await job.runOnce(FIXED_NOW)

    expect(deleteBatchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ deletedTotal: 0, batches: 0 })
  })

  it('пересчитывает cutoff при другом горизонте хранения — формула не захардкожена на 5 лет', async () => {
    const shortRetentionJob = new AuditLogRetentionJob({ deleteBatch: deleteBatchMock }, 1, BATCH_SIZE)
    deleteBatchMock.mockResolvedValue(0)

    await shortRetentionJob.runOnce(FIXED_NOW)

    const [criteria] = deleteBatchMock.mock.calls[0] as [AuditLogRetentionCriteria]
    expect(criteria.cutoff.toISOString()).toBe('2025-09-25T03:00:00.000Z')
  })

  it('каждый батч ограничен настроенным batchSize — не забыт лимит', async () => {
    deleteBatchMock.mockResolvedValue(0)

    await job.runOnce(FIXED_NOW)

    const [criteria] = deleteBatchMock.mock.calls[0] as [AuditLogRetentionCriteria]
    expect(criteria.batchSize).toBe(BATCH_SIZE)
  })

  it('ошибка порта логируется и пробрасывается — не проглатывается молча', async () => {
    deleteBatchMock.mockRejectedValue(new Error('permission denied for table audit_log'))

    await expect(job.runOnce(FIXED_NOW)).rejects.toThrow('permission denied for table audit_log')
  })
})
