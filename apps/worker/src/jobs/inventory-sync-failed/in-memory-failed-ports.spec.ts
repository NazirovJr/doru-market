/**
 * Тест InMemory-двойников `inventory-sync-failed` (EP-05, DTJ-155). Эти классы — тестовые
 * заглушки портов, но именно на них стоит DI-граф `InventorySyncFailedModule` (R1-бутстрап) —
 * двойник, который врёт про свой контракт (сохранил → прочитал ≠ то же самое), обесценивает
 * всё, что на нём построено.
 */
import { describe, expect, it } from 'vitest'
import {
  InMemoryInventoryOutbox,
  InMemoryInventorySyncBatchRepository,
  SystemClock,
} from './in-memory-failed-ports.js'
import type { InventorySyncBatchSnapshot, ProcessingFailedAlertEvent } from './inventory-sync-ports.js'

describe('SystemClock', () => {
  it('now() возвращает Date, близкий к реальному текущему времени', () => {
    const before = Date.now()
    const now = new SystemClock().now()
    const after = Date.now()

    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after)
  })
})

describe('InMemoryInventorySyncBatchRepository', () => {
  function snapshot(overrides: Partial<InventorySyncBatchSnapshot> = {}): InventorySyncBatchSnapshot {
    return { id: 'B-1', pharmacyId: 'P-1', status: 'processing', syncType: 'delta', ...overrides }
  }

  it('findById по неизвестному id возвращает null (пустое хранилище)', async () => {
    const repo = new InMemoryInventorySyncBatchRepository()

    await expect(repo.findById('missing')).resolves.toBeNull()
  })

  it('save() затем findById() возвращает ТУ ЖЕ запись (round-trip контракта порта)', async () => {
    const repo = new InMemoryInventorySyncBatchRepository()
    const batch = snapshot()

    await repo.save(batch)
    const found = await repo.findById('B-1')

    expect(found).toEqual(batch)
  })

  it('повторный save() с тем же id перезаписывает снэпшот, а не дублирует', async () => {
    const repo = new InMemoryInventorySyncBatchRepository()
    await repo.save(snapshot({ status: 'processing' }))

    await repo.save(snapshot({ status: 'failed_validation' }))
    const found = await repo.findById('B-1')

    expect(found?.status).toBe('failed_validation')
  })

  it('save() с другим id хранится независимо от первого', async () => {
    const repo = new InMemoryInventorySyncBatchRepository()
    await repo.save(snapshot({ id: 'B-1' }))
    await repo.save(snapshot({ id: 'B-2', status: 'completed_full_success' }))

    await expect(repo.findById('B-1')).resolves.toMatchObject({ status: 'processing' })
    await expect(repo.findById('B-2')).resolves.toMatchObject({ status: 'completed_full_success' })
  })

  it('appendError() накапливает записи в порядке вызовов, доступные через `errors`', async () => {
    const repo = new InMemoryInventorySyncBatchRepository()

    await repo.appendError({ batchId: 'B-1', rowIndex: 3, errorCode: 'processing_failed', errorDetail: 'x' })
    await repo.appendError({ batchId: 'B-1', rowIndex: null, errorCode: 'processing_failed', errorDetail: 'y' })

    expect(repo.errors).toEqual([
      { batchId: 'B-1', rowIndex: 3, errorCode: 'processing_failed', errorDetail: 'x' },
      { batchId: 'B-1', rowIndex: null, errorCode: 'processing_failed', errorDetail: 'y' },
    ])
  })
})

describe('InMemoryInventoryOutbox', () => {
  function alert(overrides: Partial<ProcessingFailedAlertEvent> = {}): ProcessingFailedAlertEvent {
    return {
      eventType: 'inventory.sync_batch.processing_failed',
      batchId: 'B-1',
      pharmacyId: 'P-1',
      attemptsMade: 5,
      lastErrorCode: 'processing_failed',
      ...overrides,
    }
  }

  it('пустой outbox по умолчанию не содержит алертов', () => {
    const outbox = new InMemoryInventoryOutbox()

    expect(outbox.alerts).toEqual([])
  })

  it('appendProcessingFailedAlert() накапливает события в порядке публикации (round-trip)', () => {
    const outbox = new InMemoryInventoryOutbox()
    const first = alert({ batchId: 'B-1' })
    const second = alert({ batchId: 'B-2', attemptsMade: 1 })

    outbox.appendProcessingFailedAlert(first)
    outbox.appendProcessingFailedAlert(second)

    expect(outbox.alerts).toEqual([first, second])
  })
})
