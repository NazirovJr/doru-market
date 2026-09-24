// Локальный фейк порта, не InMemory из infrastructure — application её не импортирует.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import type {
  ListByPharmacyCursor,
  ListByPharmacyResult,
  PharmacyInventoryListRow,
  PharmacyInventoryRepository,
} from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import { ListPharmacyInventoryUseCase } from './list-pharmacy-inventory.use-case.js'

class FakeListOnlyPharmacyInventoryRepository implements PharmacyInventoryRepository {
  private readonly rowsByPharmacy = new Map<string, PharmacyInventoryListRow[]>()

  seedListRow(pharmacyId: string, row: PharmacyInventoryListRow): void {
    const rows = this.rowsByPharmacy.get(pharmacyId) ?? []
    rows.push(row)
    this.rowsByPharmacy.set(pharmacyId, rows)
  }

  listByPharmacy(input: {
    pharmacyId: string
    q: string | null
    cursor: ListByPharmacyCursor | null
    limit: number
  }): Promise<ListByPharmacyResult> {
    const all = (this.rowsByPharmacy.get(input.pharmacyId) ?? [])
      .filter((row) => this.isAfterCursor(row, input.cursor))
      .slice()
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName) || a.inventoryId.localeCompare(b.inventoryId))
    const hasMore = all.length > input.limit
    return Promise.resolve({ items: hasMore ? all.slice(0, input.limit) : all, hasMore })
  }

  private isAfterCursor(row: PharmacyInventoryListRow, cursor: ListByPharmacyCursor | null): boolean {
    if (cursor === null) return true
    if (row.tradeName > cursor.tradeName) return true
    return row.tradeName === cursor.tradeName && row.inventoryId > cursor.id
  }

  upsertMany(): Promise<never> {
    throw new Error('not used in list tests')
  }

  findOrCreateManyByMedicineIds(): Promise<never> {
    throw new Error('not used in list tests')
  }

  saveMany(): Promise<never> {
    throw new Error('not used in list tests')
  }
}

function makeRow(overrides: Partial<PharmacyInventoryListRow> = {}): PharmacyInventoryListRow {
  return {
    inventoryId: 'inv-1',
    medicineId: 'med-1',
    tradeName: 'Aspirin',
    dosageForm: 'tablets',
    dosageStrength: '500 mg',
    priceDiram: 1250,
    stockQuantity: 10,
    batchNumber: null,
    expiryDate: '2030-01-01',
    lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('ListPharmacyInventoryUseCase (DTJ-171)', () => {
  it('пустая страница — nextCursor=null, hasMore=false', async () => {
    const repo = new FakeListOnlyPharmacyInventoryRepository()
    const useCase = new ListPharmacyInventoryUseCase(repo)

    const result = await useCase.execute({ pharmacyId: 'pharm-1', q: null, cursor: null, limit: 50 })

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('строит nextCursor из последнего элемента страницы, когда hasMore=true', async () => {
    const repo = new FakeListOnlyPharmacyInventoryRepository()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-1', tradeName: 'A' }))
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-2', tradeName: 'B' }))
    const useCase = new ListPharmacyInventoryUseCase(repo)

    const result = await useCase.execute({ pharmacyId: 'pharm-1', q: null, cursor: null, limit: 1 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.tradeName).toBe('A')
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual({ tradeName: 'A', id: 'inv-1' })
  })

  it('последняя страница — hasMore=false, nextCursor=null', async () => {
    const repo = new FakeListOnlyPharmacyInventoryRepository()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-1', tradeName: 'A' }))
    const useCase = new ListPharmacyInventoryUseCase(repo)

    const result = await useCase.execute({ pharmacyId: 'pharm-1', q: null, cursor: null, limit: 50 })

    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('изолирует по pharmacyId — чужая аптека не попадает в выдачу', async () => {
    const repo = new FakeListOnlyPharmacyInventoryRepository()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-1', tradeName: 'A' }))
    repo.seedListRow('pharm-2', makeRow({ inventoryId: 'inv-2', tradeName: 'B' }))
    const useCase = new ListPharmacyInventoryUseCase(repo)

    const result = await useCase.execute({ pharmacyId: 'pharm-1', q: null, cursor: null, limit: 50 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.inventoryId).toBe('inv-1')
  })

  it('граничные цены (0.01 TJS / 99999999.99 TJS в дирамах) проходят без искажения', async () => {
    const repo = new FakeListOnlyPharmacyInventoryRepository()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-1', tradeName: 'A', priceDiram: 1 }))
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-2', tradeName: 'B', priceDiram: 9_999_999_999 }))
    const useCase = new ListPharmacyInventoryUseCase(repo)

    const result = await useCase.execute({ pharmacyId: 'pharm-1', q: null, cursor: null, limit: 50 })

    expect(result.items.map((item) => item.priceDiram)).toEqual([1, 9_999_999_999])
  })
})
