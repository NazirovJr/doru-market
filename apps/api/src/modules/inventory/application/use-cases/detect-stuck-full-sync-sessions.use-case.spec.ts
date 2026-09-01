/**
 * Тест `DetectStuckFullSyncSessionsUseCase` (EP-05, DTJ-152, SRS-INV-061).
 */
import { describe, expect, it } from 'vitest'
import { InMemoryInventorySyncBatchRepository } from '../../infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryInventoryOutbox } from '../../infrastructure/adapters/in-memory-inventory-outbox.js'
import { DetectStuckFullSyncSessionsUseCase } from './detect-stuck-full-sync-sessions.use-case.js'
import { InventorySyncBatch } from '../../domain/inventory-sync-batch.entity.js'

function makeBatch(
  id: string,
  pharmacyId: string,
  fullSyncSessionId: string | null,
  isLastPage: boolean,
  receivedAt: Date,
): InventorySyncBatch {
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
    const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
    const outbox = new InMemoryInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch = makeBatch('b-1', 'p-1', 's-1', false, oldDate)
    await syncBatchRepository.save(batch)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(1)
    expect(outbox.stuckEvents.length).toBe(1)
  })

  it('сессия моложе таймаута не помечается', async () => {
    const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
    const outbox = new InMemoryInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const recent = new Date(Date.now() - 5 * 60_000) // 5 минут назад
    const batch = makeBatch('b-1', 'p-1', 's-1', false, recent)
    await syncBatchRepository.save(batch)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(0)
  })

  it('сессия с полученной последней страницей не считается зависшей', async () => {
    const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
    const outbox = new InMemoryInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch1 = makeBatch('b-1', 'p-1', 's-1', true, oldDate)
    await syncBatchRepository.save(batch1)
    const result = await useCase.execute(60)
    expect(result.stuckSessionsCount).toBe(0)
  })

  it('повторный прогон не дублирует событие для уже заалерченной сессии', async () => {
    const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
    const outbox = new InMemoryInventoryOutbox()
    const useCase = new DetectStuckFullSyncSessionsUseCase(syncBatchRepository, outbox)
    const oldDate = new Date('2026-01-15T08:00:00.000Z')
    const batch = makeBatch('b-1', 'p-1', 's-1', false, oldDate)
    await syncBatchRepository.save(batch)
    const r1 = await useCase.execute(60)
    const r2 = await useCase.execute(60)
    expect(r1.stuckSessionsCount).toBe(1)
    expect(r2.stuckSessionsCount).toBe(0)
    expect(outbox.stuckEvents.length).toBe(1)
  })
})
