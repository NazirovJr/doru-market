import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PruneSearchQueryLogProcessor } from './prune-search-query-log.processor.js'
import type { SearchQueryLogRetentionPort } from './search-query-log-retention.port.js'

const FIXED_NOW = new Date('2026-08-31T10:00:00.000Z')
const RETENTION_DAYS = 180

describe('PruneSearchQueryLogProcessor', () => {
  // Отдельная переменная для мока (не `retention.deleteOlderThan` напрямую) — иначе
  // @typescript-eslint/unbound-method ругается на ссылку на метод интерфейса без вызова
  // (конвенция OutboxRelayProcessor.spec.ts).
  let deleteOlderThanMock: Mock<SearchQueryLogRetentionPort['deleteOlderThan']>
  let processor: PruneSearchQueryLogProcessor

  beforeEach(() => {
    deleteOlderThanMock = vi.fn()
    const retention: SearchQueryLogRetentionPort = { deleteOlderThan: deleteOlderThanMock }
    processor = new PruneSearchQueryLogProcessor(retention, RETENTION_DAYS)
  })

  it('вычисляет cutoff детерминированно от переданного `now`, БЕЗ реального времени (Ж13/тест-план DTJ-181)', async () => {
    deleteOlderThanMock.mockResolvedValue(0)

    await processor.runOnce(FIXED_NOW)

    expect(deleteOlderThanMock).toHaveBeenCalledTimes(1)
    const [cutoff] = deleteOlderThanMock.mock.calls[0] as [Date]
    expect(cutoff.toISOString()).toBe('2026-03-04T10:00:00.000Z') // FIXED_NOW - 180 дней
  })

  it('возвращает число удалённых строк от порта (AC3: записи старше 180 дней удалены)', async () => {
    deleteOlderThanMock.mockResolvedValue(42)

    const deleted = await processor.runOnce(FIXED_NOW)

    expect(deleted).toBe(42)
  })

  it('возвращает 0 без ошибки, когда нет записей старше горизонта хранения (AC3: младше — не удалены)', async () => {
    deleteOlderThanMock.mockResolvedValue(0)

    const deleted = await processor.runOnce(FIXED_NOW)

    expect(deleted).toBe(0)
  })

  it('пересчитывает cutoff при другом горизонте хранения — формула не захардкожена на 180', async () => {
    const shortRetentionProcessor = new PruneSearchQueryLogProcessor(
      { deleteOlderThan: deleteOlderThanMock },
      1,
    )
    deleteOlderThanMock.mockResolvedValue(0)

    await shortRetentionProcessor.runOnce(FIXED_NOW)

    const [cutoff] = deleteOlderThanMock.mock.calls[0] as [Date]
    expect(cutoff.toISOString()).toBe('2026-08-30T10:00:00.000Z')
  })
})
