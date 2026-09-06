/**
 * Тест `DetectStuckFullSyncSessionsUseCase` (EP-05, DTJ-152, SRS-INV-061).
 */
import { describe, expect, it } from 'vitest'
import { DetectStuckFullSyncSessionsUseCase } from './detect-stuck-full-sync-sessions.use-case.js'
import { InventorySyncBatch } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type {
  CreateInventorySyncBatchInput,
  IncompleteFullSyncSession,
  InventorySyncBatchRepository,
  InventorySyncRowError,
  RawInventoryRow,
} from '../ports/inventory-sync-batch.repository.port.js'
import type { InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'
import type {
  FullSyncSessionStuckEvent,
  InventoryBatchQueuedEvent,
  InventoryOutboxPort,
  UnmatchedInventoryRowEvent,
} from '../ports/inventory-outbox.port.js'

const MS_PER_MINUTE = 60_000

/**
 * Локальные Map-based фейки портов (не production `InMemory*`-адаптеры из
 * infrastructure: application не импортирует infrastructure, §1.1). Логика
 * группировки/дедупликации повторяет production-адаптер намеренно — это
 * как раз то поведение, которое тест проверяет.
 */
class FakeInventorySyncBatchRepository implements InventorySyncBatchRepository {
  private readonly batches = new Map<string, InventorySyncBatch>()

  create(_input: CreateInventorySyncBatchInput): Promise<{ readonly id: string }> {
    throw new Error('not used in detect-stuck tests')
  }

  markStatus(_id: string, _status: InventorySyncStatus): Promise<void> {
    throw new Error('not used in detect-stuck tests')
  }

  findById(id: string): Promise<InventorySyncBatch | null> {
    return Promise.resolve(this.batches.get(id) ?? null)
  }

  save(batch: InventorySyncBatch): Promise<void> {
    this.batches.set(batch.id, batch)
    return Promise.resolve()
  }

  appendErrors(_errors: readonly InventorySyncRowError[]): Promise<void> {
    throw new Error('not used in detect-stuck tests')
  }

  findRawItems(_batchId: string): Promise<readonly RawInventoryRow[]> {
    throw new Error('not used in detect-stuck tests')
  }

  createIfNotExists(_input: {
    readonly id: string
    readonly pharmacyId: string
    readonly channel: 'rest' | 'excel' | 'manual'
    readonly syncType: 'delta' | 'full'
    readonly fullSyncSessionId: string | null
    readonly isLastPage: boolean
    readonly totalRows: number
    readonly note: string | null
    readonly now: Date
  }): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    throw new Error('not used in detect-stuck tests')
  }

  appendRawItems(
    _batchId: string,
    _items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void> {
    throw new Error('not used in detect-stuck tests')
  }

  findIncompleteFullSyncSessions(
    olderThanMinutes: number,
  ): Promise<readonly IncompleteFullSyncSession[]> {
    const now = new Date()
    const cutoff = new Date(now.getTime() - olderThanMinutes * MS_PER_MINUTE)
    const grouped = new Map<string, IncompleteFullSyncSession>()
    for (const batch of this.batches.values()) {
      if (batch.syncType !== 'full' || batch.fullSyncSessionId === null) continue
      const key = `${batch.fullSyncSessionId}::${batch.pharmacyId}`
      const existing = grouped.get(key)
      if (existing === undefined || batch.receivedAt > existing.lastPageReceivedAt) {
        grouped.set(key, {
          fullSyncSessionId: batch.fullSyncSessionId,
          pharmacyId: batch.pharmacyId,
          lastPageReceivedAt: batch.receivedAt,
        })
      }
    }
    const result: IncompleteFullSyncSession[] = []
    for (const session of grouped.values()) {
      const hasLastPage = Array.from(this.batches.values()).some(
        (b) =>
          b.fullSyncSessionId === session.fullSyncSessionId &&
          b.pharmacyId === session.pharmacyId &&
          b.isLastPage,
      )
      if (hasLastPage) continue
      if (session.lastPageReceivedAt >= cutoff) continue
      result.push(session)
    }
    return Promise.resolve(result)
  }

  findPharmacyChainId(_pharmacyId: string): Promise<string | null> {
    throw new Error('not used in detect-stuck tests')
  }

  findManyForReport(_input: {
    readonly pharmacyId: string | null
    readonly chainId: string | null
    readonly cursor: { readonly v: string; readonly id: string } | null
    readonly limit: number
  }): ReturnType<InventorySyncBatchRepository['findManyForReport']> {
    throw new Error('not used in detect-stuck tests')
  }

  findRowErrorsByBatchId(_batchId: string): ReturnType<InventorySyncBatchRepository['findRowErrorsByBatchId']> {
    throw new Error('not used in detect-stuck tests')
  }

  findBySourceUploadId(_sourceUploadId: string): ReturnType<InventorySyncBatchRepository['findBySourceUploadId']> {
    throw new Error('not used in detect-stuck tests')
  }
}

class FakeInventoryOutbox implements InventoryOutboxPort {
  public readonly events: UnmatchedInventoryRowEvent[] = []
  public readonly stuckEvents: FullSyncSessionStuckEvent[] = []
  public readonly batchQueuedEvents: InventoryBatchQueuedEvent[] = []
  private readonly stuckAlertedAt: { fullSyncSessionId: string; at: Date }[] = []

  append(event: UnmatchedInventoryRowEvent): void {
    this.events.push(event)
  }

  appendStuckSession(event: FullSyncSessionStuckEvent): void {
    this.stuckEvents.push(event)
    this.stuckAlertedAt.push({ fullSyncSessionId: event.fullSyncSessionId, at: new Date() })
  }

  appendBatchQueued(event: InventoryBatchQueuedEvent): void {
    this.batchQueuedEvents.push(event)
  }

  hasStuckAlert(fullSyncSessionId: string, withinMinutes: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - withinMinutes * MS_PER_MINUTE)
    return Promise.resolve(
      this.stuckAlertedAt.some((e) => e.fullSyncSessionId === fullSyncSessionId && e.at >= cutoff),
    )
  }
}

function makeBatch(input: {
  id: string
  pharmacyId: string
  fullSyncSessionId: string | null
  isLastPage: boolean
  receivedAt: Date
}): InventorySyncBatch {
  const { id, pharmacyId, fullSyncSessionId, isLastPage, receivedAt } = input
  const props = {
    id,
    pharmacyId,
    channel: 'rest' as const,
    syncType: fullSyncSessionId !== null ? ('full' as const) : ('delta' as const),
    totalRows: 1,
  }
  const batch = fullSyncSessionId !== null
    ? InventorySyncBatch.create(
        { ...props, fullSyncSessionId, isLastPage },
        receivedAt,
      )
    : InventorySyncBatch.create(props, receivedAt)
  return batch
}

describe('DetectStuckFullSyncSessionsUseCase (DTJ-152, SRS-INV-061)', () => {
  it('сессия старше таймаута без последней страницы помечается зависшей', async () => {
    const syncBatchRepository = new FakeInventorySyncBatchRepository()
    const outbox = new FakeInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch = makeBatch({ id: 'b-1', pharmacyId: 'p-1', fullSyncSessionId: 's-1', isLastPage: false, receivedAt: oldDate })
    await syncBatchRepository.save(batch)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(1)
    expect(outbox.stuckEvents.length).toBe(1)
  })

  it('сессия моложе таймаута не помечается', async () => {
    const syncBatchRepository = new FakeInventorySyncBatchRepository()
    const outbox = new FakeInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const recent = new Date(Date.now() - 5 * 60_000) // 5 минут назад
    const batch = makeBatch({ id: 'b-1', pharmacyId: 'p-1', fullSyncSessionId: 's-1', isLastPage: false, receivedAt: recent })
    await syncBatchRepository.save(batch)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(0)
  })

  it('сессия с полученной последней страницей не считается зависшей', async () => {
    const syncBatchRepository = new FakeInventorySyncBatchRepository()
    const outbox = new FakeInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch1 = makeBatch({ id: 'b-1', pharmacyId: 'p-1', fullSyncSessionId: 's-1', isLastPage: true, receivedAt: oldDate })
    await syncBatchRepository.save(batch1)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(0)
  })

  it('повторный прогон не дублирует событие для уже заалерченной сессии', async () => {
    const syncBatchRepository = new FakeInventorySyncBatchRepository()
    const outbox = new FakeInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch = makeBatch({ id: 'b-1', pharmacyId: 'p-1', fullSyncSessionId: 's-1', isLastPage: false, receivedAt: oldDate })
    await syncBatchRepository.save(batch)
    const r1 = await useCase.execute(60)
    const r2 = await useCase.execute(60)
    expect(r1.stuckSessionsCount).toBe(1)
    expect(r2.stuckSessionsCount).toBe(0)
    expect(outbox.stuckEvents.length).toBe(1)
  })
})
