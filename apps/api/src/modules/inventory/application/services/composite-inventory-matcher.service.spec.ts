/**
 * Тест `CompositeInventoryMatcherService` (EP-05, DTJ-146/147, SRS-INV-019..027, D-06).
 *
 * DTJ-146 (шаги 1-2): штрихкод, кэш, точное совпадение.
 * DTJ-147 (шаги 3-4): fuzzy-резолюция, дозировочный фильтр, неоднозначность.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CompositeInventoryMatcherService,
  type NeedsFuzzyRow,
  type UnresolvedRowInput,
} from './composite-inventory-matcher.service.js'
import type { CatalogFacade, FuzzyCandidate } from '../ports/catalog-facade.port.js'
import type {
  PharmacySkuMappingEntry,
  PharmacySkuMappingRepository,
} from '../ports/pharmacy-sku-mapping.repository.port.js'
import type {
  FullSyncSessionStuckEvent,
  InventoryBatchQueuedEvent,
  InventoryOutboxPort,
  UnmatchedInventoryRowEvent,
} from '../ports/inventory-outbox.port.js'

/**
 * Локальные Map-based фейки портов (не production `InMemory*`-адаптеры из
 * infrastructure: application не импортирует infrastructure, §1.1).
 */
class FakePharmacySkuMappingRepository implements PharmacySkuMappingRepository {
  private readonly store = new Map<string, PharmacySkuMappingEntry>()

  private static compositeKey(pharmacyId: string, internalSku: string): string {
    return `${pharmacyId}::${internalSku}`
  }

  findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>> {
    const result = new Map<string, PharmacySkuMappingEntry>()
    for (const sku of skus) {
      const entry = this.store.get(FakePharmacySkuMappingRepository.compositeKey(pharmacyId, sku))
      if (entry !== undefined) {
        result.set(sku, entry)
      }
    }
    return Promise.resolve(result)
  }

  upsert(input: {
    pharmacyId: string
    internalSku: string
    medicineId: string
    matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
  }): Promise<void> {
    const key = FakePharmacySkuMappingRepository.compositeKey(input.pharmacyId, input.internalSku)
    this.store.set(key, { medicineId: input.medicineId, matchedVia: input.matchedVia })
    return Promise.resolve()
  }
}

class FakeInventoryOutbox implements InventoryOutboxPort {
  public readonly events: UnmatchedInventoryRowEvent[] = []
  public readonly stuckEvents: FullSyncSessionStuckEvent[] = []
  public readonly batchQueuedEvents: InventoryBatchQueuedEvent[] = []

  append(event: UnmatchedInventoryRowEvent): void {
    this.events.push(event)
  }

  appendStuckSession(event: FullSyncSessionStuckEvent): void {
    this.stuckEvents.push(event)
  }

  appendBatchQueued(event: InventoryBatchQueuedEvent): void {
    this.batchQueuedEvents.push(event)
  }

  hasStuckAlert(_fullSyncSessionId: string, _withinMinutes: number): Promise<boolean> {
    return Promise.resolve(false)
  }
}

const PHARMACY_ID = '22222222-2222-2222-2222-222222222222'
const MEDICINE_1 = '11111111-1111-1111-1111-111111111111'
const MEDICINE_2 = '55555555-5555-5555-5555-555555555555'
const MEDICINE_3 = '99999999-9999-9999-9999-999999999999'
const VALID_GLOBAL_BARCODE = '4601234567893'
const INTERNAL_BARCODE = '2001234567896'
const INVALID_BARCODE = '4601234567899'

function row(rowIndex: number, internalSku: string, rawBarcode: string | null): UnresolvedRowInput {
  return { rowIndex, internalSku, rawBarcode }
}

function fuzzyRow(input: {
  rowIndex: number
  internalSku: string
  rawBarcode: string | null
  rawTradeName: string
  rawDosageStrength?: string | null
}): NeedsFuzzyRow {
  return {
    rowIndex: input.rowIndex,
    internalSku: input.internalSku,
    rawBarcode: input.rawBarcode,
    rawTradeName: input.rawTradeName,
    rawDosageForm: 'tablets',
    rawDosageStrength: input.rawDosageStrength ?? null,
    rawManufacturerName: 'Acme',
  }
}

function makeFacadeMock(candidatesByIndex: ReadonlyMap<number, readonly FuzzyCandidate[]> = new Map()): {
  facade: CatalogFacade
  findByBarcodesCalls: string[][]
  findFuzzyCalls: number[]
} {
  const findByBarcodesCalls: string[][] = []
  const findFuzzyCalls: number[] = []
  return {
    findByBarcodesCalls,
    findFuzzyCalls,
    facade: {
      findMedicineIdsByBarcodes: vi.fn((barcodes: readonly string[]) => {
        findByBarcodesCalls.push([...barcodes])
        const result = new Map<string, string>()
        if (barcodes.includes(VALID_GLOBAL_BARCODE)) {
          result.set(VALID_GLOBAL_BARCODE, MEDICINE_1)
        }
        return Promise.resolve(result)
      }),
      findFuzzyCandidates: vi.fn((rows: readonly unknown[]) => {
        findFuzzyCalls.push(rows.length)
        return Promise.resolve(candidatesByIndex)
      }),
    },
  }
}

async function makeMappingMock(seed: ReadonlyMap<string, PharmacySkuMappingEntry> = new Map()): Promise<{
  repo: PharmacySkuMappingRepository
  inMemory: FakePharmacySkuMappingRepository
}> {
  const inMemory = new FakePharmacySkuMappingRepository()
  for (const [key, value] of seed) {
    // `key` имеет формат `${pharmacyId}::${internalSku}` (см. FakePharmacySkuMappingRepository.compositeKey).
    // Используем публичный API `upsert`, а не приватный `store.set`, чтобы не нарушать
    // инкапсуляцию (test-double повторяет контракт PharmacySkuMappingRepository).
    const [pharmacyId, internalSku] = key.split('::')
    if (pharmacyId === undefined || internalSku === undefined) {
      throw new Error(`invalid composite key: ${key}`)
    }
    await inMemory.upsert({
      pharmacyId,
      internalSku,
      medicineId: value.medicineId,
      matchedVia: value.matchedVia,
    })
  }
  return { repo: inMemory, inMemory }
}

describe('CompositeInventoryMatcherService — matchBatch (DTJ-146, шаги 1-2)', () => {
  it('строка с найденным SKU в кэше возвращает outcome=cached, CatalogFacade не вызывается', async () => {
    const seed = new Map<string, PharmacySkuMappingEntry>([
      [`${PHARMACY_ID}::SKU-042`, { medicineId: MEDICINE_2, matchedVia: 'barcode' }],
    ])
    const { repo } = await makeMappingMock(seed)
    const { facade, findByBarcodesCalls } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-042', VALID_GLOBAL_BARCODE)])
    expect(results[0]?.outcome).toBe('cached')
    if (results[0]?.outcome === 'cached') {
      expect(results[0].medicineId).toBe(MEDICINE_2)
    }
    expect(findByBarcodesCalls.length).toBe(0)
  })

  it('штрихкод с префиксом 2 не участвует в точном совпадении (D-06, internal prefix)', async () => {
    const { repo } = await makeMappingMock()
    const { facade, findByBarcodesCalls } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-INT', INTERNAL_BARCODE)])
    expect(results[0]?.outcome).toBe('needs_fuzzy')
    expect(findByBarcodesCalls[0]).toEqual([])
  })

  it('невалидный EAN-13 (неверная контрольная цифра) не участвует в точном совпадении', async () => {
    const { repo } = await makeMappingMock()
    const { facade, findByBarcodesCalls } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-INV', INVALID_BARCODE)])
    expect(results[0]?.outcome).toBe('needs_fuzzy')
    expect(findByBarcodesCalls[0]).toEqual([])
  })

  it('штрихкод без префикса 2, валидный EAN-13, найден в medicines → exact_barcode', async () => {
    const { repo } = await makeMappingMock()
    const { facade } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-NEW', VALID_GLOBAL_BARCODE)])
    expect(results[0]?.outcome).toBe('exact_barcode')
    if (results[0]?.outcome === 'exact_barcode') {
      expect(results[0].medicineId).toBe(MEDICINE_1)
    }
  })

  it('успешный точный матч обновляет pharmacy_sku_mapping через upsert() (идемпотентность кэша)', async () => {
    const { repo, inMemory } = await makeMappingMock()
    const { facade } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-A', VALID_GLOBAL_BARCODE)])
    await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-A', VALID_GLOBAL_BARCODE)])
    const cache = await inMemory.findManyByPharmacyAndSkus(PHARMACY_ID, ['SKU-A'])
    expect(cache.has('SKU-A')).toBe(true)
  })

  it('findManyByPharmacyAndSkus вызывается ровно один раз на весь батч (SRS-INV-052 п.1)', async () => {
    const { repo } = await makeMappingMock()
    const { facade, findByBarcodesCalls } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const rows: readonly UnresolvedRowInput[] = [
      row(0, 'A', VALID_GLOBAL_BARCODE),
      row(1, 'B', null),
      row(2, 'C', INVALID_BARCODE),
      row(3, 'D', INTERNAL_BARCODE),
      row(4, 'E', null),
    ]
    await service.matchBatch(PHARMACY_ID, rows)
    expect(findByBarcodesCalls.length).toBe(1)
  })

  it('строка без barcode сразу передаётся на fuzzy (outcome=needs_fuzzy)', async () => {
    const { repo } = await makeMappingMock()
    const { facade } = makeFacadeMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-NB', null)])
    expect(results[0]?.outcome).toBe('needs_fuzzy')
  })

  it('без CatalogFacade (Optional) все строки без кэша → needs_fuzzy, без падения', async () => {
    const { repo } = await makeMappingMock()
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, null, outbox)
    const results = await service.matchBatch(PHARMACY_ID, [row(0, 'SKU-Z', VALID_GLOBAL_BARCODE)])
    expect(results[0]?.outcome).toBe('needs_fuzzy')
  })
})

describe('CompositeInventoryMatcherService — resolveFuzzyCandidates (DTJ-147, шаги 3-4)', () => {
  it('score ниже 0.35 даёт unmatched/no_candidate', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.28, dosageStrength: '500 мг' },
        ],
      ],
    ])
    const { facade, findFuzzyCalls } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Цитрамон П', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('unmatched')
    if (results[0]?.outcome === 'unmatched') {
      expect(results[0].reason).toBe('no_candidate')
    }
    expect(findFuzzyCalls.length).toBe(1)
    expect(outbox.events.length).toBe(1)
  })

  it('несовпадение dosageStrength отбрасывает кандидата с высоким textual score', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.9, dosageStrength: '1000 мг' },
        ],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('unmatched')
    if (results[0]?.outcome === 'unmatched') {
      expect(results[0].reason).toBe('no_candidate')
    }
  })

  it('отброшенный кандидат уступает место следующему из топ-5', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.9, dosageStrength: '1000 мг' },
          { medicineId: MEDICINE_2, combinedScore: 0.5, dosageStrength: '500 мг' },
        ],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('matched')
    if (results[0]?.outcome === 'matched') {
      expect(results[0].medicineId).toBe(MEDICINE_2)
    }
  })

  it('разница score < AMBIGUITY_GAP (0.05) даёт unmatched/ambiguous', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.4, dosageStrength: '500 мг' },
          { medicineId: MEDICINE_2, combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('unmatched')
    if (results[0]?.outcome === 'unmatched') {
      expect(results[0].reason).toBe('ambiguous')
    }
  })

  it('разница score >= AMBIGUITY_GAP даёт matched с top1', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.5, dosageStrength: '500 мг' },
          { medicineId: MEDICINE_2, combinedScore: 0.4, dosageStrength: '500 мг' },
        ],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('matched')
    if (results[0]?.outcome === 'matched') {
      expect(results[0].medicineId).toBe(MEDICINE_1)
    }
  })

  it('единственный кандидат даёт matched без проверки на неоднозначность', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [{ medicineId: MEDICINE_3, combinedScore: 0.37, dosageStrength: '500 мг' }],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    const results = await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(results[0]?.outcome).toBe('matched')
    if (results[0]?.outcome === 'matched') {
      expect(results[0].medicineId).toBe(MEDICINE_3)
    }
  })

  it('успешный fuzzy-матч обновляет pharmacy_sku_mapping с matchedVia=name_fuzzy', async () => {
    const { repo, inMemory } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [{ medicineId: MEDICINE_1, combinedScore: 0.9, dosageStrength: '500 мг' }],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    const cache = await inMemory.findManyByPharmacyAndSkus(PHARMACY_ID, ['SKU-A'])
    expect(cache.get('SKU-A')?.matchedVia).toBe('name_fuzzy')
    expect(cache.get('SKU-A')?.medicineId).toBe(MEDICINE_1)
  })

  it('findFuzzyCandidates вызывается одним пакетным запросом на весь набор', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [{ medicineId: MEDICINE_1, combinedScore: 0.9, dosageStrength: '500 мг' }],
      ],
    ])
    const { facade, findFuzzyCalls } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'A', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
      fuzzyRow({ rowIndex: 1, internalSku: 'B', rawBarcode: null, rawTradeName: 'Ибупрофен', rawDosageStrength: '200 мг' }),
      fuzzyRow({ rowIndex: 2, internalSku: 'C', rawBarcode: null, rawTradeName: 'Цитрамон', rawDosageStrength: '300 мг' }),
    ])
    expect(findFuzzyCalls.length).toBe(1)
    expect(findFuzzyCalls[0]).toBe(3)
  })

  it('unmatched-строки формируют корректный UnmatchedInventoryRowEvent в outbox', async () => {
    const { repo } = await makeMappingMock()
    const candidates = new Map<number, readonly FuzzyCandidate[]>([
      [
        0,
        [
          { medicineId: MEDICINE_1, combinedScore: 0.4, dosageStrength: '500 мг' },
          { medicineId: MEDICINE_2, combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      ],
    ])
    const { facade } = makeFacadeMock(candidates)
    const outbox = new FakeInventoryOutbox()
    const service = new CompositeInventoryMatcherService(repo, facade, outbox)
    await service.resolveFuzzyCandidates(PHARMACY_ID, [
      fuzzyRow({ rowIndex: 0, internalSku: 'SKU-AMB', rawBarcode: null, rawTradeName: 'Аспирин', rawDosageStrength: '500 мг' }),
    ])
    expect(outbox.events.length).toBe(1)
    expect(outbox.events[0]?.eventType).toBe('inventory.row.unmatched')
    expect(outbox.events[0]?.reason).toBe('ambiguous')
    expect(outbox.events[0]?.rawRowPayload.internalSku).toBe('SKU-AMB')
  })
})
