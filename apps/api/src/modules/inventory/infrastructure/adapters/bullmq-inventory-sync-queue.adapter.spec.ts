/**
 * Тест BullMQ-адаптера (EP-05, DTJ-153).
 *
 * Покрывает:
 *   1. `resolveInventorySyncJobPriority` — таблица приоритетов (SRS-INV-034).
 *   2. `enqueue()` — корректные `jobId=batchId`, `priority`, `attempts` (SRS-INV-032/035).
 *   3. Повторный `enqueue()` с тем же `batchId` отбрасывается (дедупликация).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  INVENTORY_SYNC_JOB_PRIORITY,
  resolveInventorySyncJobPriority,
} from '../../application/ports/inventory-sync-queue.port.js'
import { BullmqInventorySyncQueueAdapter } from './bullmq-inventory-sync-queue.adapter.js'

describe('resolveInventorySyncJobPriority (DTJ-153, SRS-INV-034)', () => {
  it('rest + delta → 1', () => {
    expect(resolveInventorySyncJobPriority('rest', 'delta')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.REST_OR_MANUAL_DELTA,
    )
  })

  it('manual + delta → 1', () => {
    expect(resolveInventorySyncJobPriority('manual', 'delta')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.REST_OR_MANUAL_DELTA,
    )
  })

  it('excel + delta → 5', () => {
    expect(resolveInventorySyncJobPriority('excel', 'delta')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.EXCEL_DELTA,
    )
  })

  it('ЛЮБОЙ channel + full → 10 (syncType перебивает channel)', () => {
    expect(resolveInventorySyncJobPriority('rest', 'full')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.ANY_FULL,
    )
    expect(resolveInventorySyncJobPriority('manual', 'full')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.ANY_FULL,
    )
    expect(resolveInventorySyncJobPriority('excel', 'full')).toBe(
      INVENTORY_SYNC_JOB_PRIORITY.ANY_FULL,
    )
  })
})

describe('BullmqInventorySyncQueueAdapter (DTJ-153)', () => {
  function makeAdapter(): {
    adapter: BullmqInventorySyncQueueAdapter
    addMock: ReturnType<typeof vi.fn>
    closeMock: ReturnType<typeof vi.fn>
  } {
    const addMock = vi.fn().mockResolvedValue(undefined)
    const closeMock = vi.fn().mockResolvedValue(undefined)
    // Подменяем конструктор Queue через временный импорт — для теста
    // достаточно проверить, что `add` вызван с правильными опциями.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: коннектор не используется в проверяемых методах (см. ниже подмену `queue.add`/`queue.close`).
    const adapter = new BullmqInventorySyncQueueAdapter({} as any)
    // Меняем внутренний `queue` на мок через хак: подменяем метод add.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: подмена приватного поля `queue` на фейк-BullMQ-объект ради проверки контракта адаптера.
    ;(adapter as any).queue = { add: addMock, close: closeMock }
    return { adapter, addMock, closeMock }
  }

  it('enqueue использует jobId=batchId, priority=1 для rest+delta', async () => {
    const { adapter, addMock } = makeAdapter()
    await adapter.enqueue({
      batchId: 'B-001',
      pharmacyId: 'P-1',
      channel: 'rest',
      syncType: 'delta',
    })
    expect(addMock).toHaveBeenCalledTimes(1)
    const callArgs = addMock.mock.calls[0] as unknown[]
    const options = callArgs[2] as { jobId: string; priority: number; attempts: number }
    expect(options.jobId).toBe('B-001')
    expect(options.priority).toBe(1)
    expect(options.attempts).toBe(5)
  })

  it('enqueue с excel+delta → priority=5', async () => {
    const { adapter, addMock } = makeAdapter()
    await adapter.enqueue({
      batchId: 'B-002',
      pharmacyId: 'P-1',
      channel: 'excel',
      syncType: 'delta',
    })
    const callArgs = addMock.mock.calls[0] as unknown[]
    const options = callArgs[2] as { priority: number }
    expect(options.priority).toBe(5)
  })

  it('enqueue с full → priority=10 (syncType перебивает channel)', async () => {
    const { adapter, addMock } = makeAdapter()
    await adapter.enqueue({
      batchId: 'B-003',
      pharmacyId: 'P-1',
      channel: 'rest',
      syncType: 'full',
    })
    const callArgs = addMock.mock.calls[0] as unknown[]
    const options = callArgs[2] as { priority: number }
    expect(options.priority).toBe(10)
  })

  it('повторный enqueue с тем же batchId — BullMQ отбрасывает через jobId (SRS-INV-032)', async () => {
    // Спецификация BullMQ `jobId`: повторный `add(...,{jobId})` возвращает
    // тот же `existingJob`, не дублирует. Тест проверяет, что адаптер
    // ВСЕГДА передаёт `jobId=batchId`.
    const { adapter, addMock } = makeAdapter()
    await adapter.enqueue({
      batchId: 'B-DUP',
      pharmacyId: 'P-1',
      channel: 'rest',
      syncType: 'delta',
    })
    await adapter.enqueue({
      batchId: 'B-DUP',
      pharmacyId: 'P-1',
      channel: 'rest',
      syncType: 'delta',
    })
    const call1 = addMock.mock.calls[0] as unknown[]
    const call2 = addMock.mock.calls[1] as unknown[]
    const opts1 = call1[2] as { jobId: string }
    const opts2 = call2[2] as { jobId: string }
    expect(opts1.jobId).toBe('B-DUP')
    expect(opts2.jobId).toBe('B-DUP')
    // Дедупликация — на стороне BullMQ, не адаптера. Адаптер
    // гарантирует только инвариант `jobId===batchId`.
  })

  it('onModuleDestroy вызывает queue.close()', async () => {
    const { adapter, closeMock } = makeAdapter()
    await adapter.onModuleDestroy()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })
})
