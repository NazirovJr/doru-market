import { describe, expect, it, vi } from 'vitest'
import { InventoryFacade } from './inventory.facade.js'
import type { InventorySyncBatchRepository } from './application/ports/inventory-sync-batch.repository.port.js'

// Мок — отдельная переменная (не repository.method) — @typescript-eslint/unbound-method.
function fakeRepository(activePharmacyIds: readonly string[]): {
  repository: InventorySyncBatchRepository
  findPharmacyIdsWithActivitySince: ReturnType<typeof vi.fn>
} {
  const findPharmacyIdsWithActivitySince = vi.fn().mockResolvedValue(activePharmacyIds)
  const repository: InventorySyncBatchRepository = {
    create: vi.fn(),
    markStatus: vi.fn(),
    findById: vi.fn(),
    save: vi.fn(),
    appendErrors: vi.fn(),
    findRawItems: vi.fn(),
    findIncompleteFullSyncSessions: vi.fn(),
    createIfNotExists: vi.fn(),
    appendRawItems: vi.fn(),
    findPharmacyChainId: vi.fn(),
    findManyForReport: vi.fn(),
    findRowErrorsByBatchId: vi.fn(),
    findBySourceUploadId: vi.fn(),
    findPharmacyIdsWithActivitySince,
  }
  return { repository, findPharmacyIdsWithActivitySince }
}

describe('InventoryFacade.findPharmacyIdsWithRecentSyncActivity (DTJ-382)', () => {
  it('оборачивает результат репозитория в Set', async () => {
    const { repository, findPharmacyIdsWithActivitySince } = fakeRepository(['pharmacy-1', 'pharmacy-2'])
    const facade = new InventoryFacade(repository)

    const result = await facade.findPharmacyIdsWithRecentSyncActivity(['pharmacy-1', 'pharmacy-2', 'pharmacy-3'], new Date('2026-01-01'))

    expect(result).toEqual(new Set(['pharmacy-1', 'pharmacy-2']))
    expect(findPharmacyIdsWithActivitySince).toHaveBeenCalledWith(['pharmacy-1', 'pharmacy-2', 'pharmacy-3'], new Date('2026-01-01'))
  })

  it('пустой результат репозитория → пустой Set', async () => {
    const facade = new InventoryFacade(fakeRepository([]).repository)

    await expect(facade.findPharmacyIdsWithRecentSyncActivity(['pharmacy-1'], new Date())).resolves.toEqual(new Set())
  })
})
