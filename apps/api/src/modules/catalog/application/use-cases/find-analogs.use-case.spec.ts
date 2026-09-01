/**
 * Тест `FindAnalogsUseCase` (DTJ-101, EP-07, R1).
 *
 * Проверяемые ветки (см. критерии приёмки тикета):
 *   1. Happy-path: референс 83.00 TJS, самый дешёвый аналог 18.00 TJS →
 *      `savingsDiram = 6500` (TC-CAT-013, целые дирамы, без округления).
 *   2. Референс сам дешёвый → `savings: null`, `items` всё равно непустой (TC-CAT-014).
 *   3. SQL-кандидаты есть, но `AnalogEquivalenceService` отфильтровал всех →
 *      `items: []`, `savings: null`, ошибки нет (валидный ответ).
 *   4. `limit` обрезает ПОСЛЕ сортировки по цене.
 *   5. Референс не существует → `MedicineNotFoundError`.
 *   6. Референс `isPublished = false` → `MedicineNotFoundError` (404, не 422).
 *   7. Референс `controlCategory = psychotropic` → `MedicineNotFoundError`.
 *   8. Кандидат с `isPublished = false` (между шагом 2 и шагом 4) — defense-in-depth.
 *
 * **Заглушечный режим.** Сейчас `AnalogOfferLookupPort` — `NullAnalogOfferLookupAdapter`,
 * возвращающий пустой `Map`. Поэтому `find-analogs.use-case.integration.spec.ts`
 * невозможен без реальной реализации порта; здесь тестируется вся логика
 * через подделку порта (in-memory fake, имитирующий реальные офферы).
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-101.md (критерии приёмки и тест-план)
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2
 */
import { describe, expect, it } from 'vitest'
import { DosageUnit } from '@dorutj/domain-kernel'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import type { AnalogCandidatesRepository } from '@/modules/catalog/application/ports/analog-candidates.port.js'
import type {
  AnalogOfferLookupPort,
  AnalogOfferLookupInput,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'
import {
  ANALOG_CANDIDATES_REPOSITORY,
} from '@/modules/catalog/application/ports/analog-candidates.port.js'
import {
  ANALOG_OFFER_LOOKUP_PORT,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'
import { CATALOG_REPOSITORY } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import { MedicineNotFoundError } from '@/modules/catalog/domain/errors/medicine-not-found.error.js'
import {
  FindAnalogsUseCase,
  ANALOG_CANDIDATES_LIMIT,
} from '@/modules/catalog/application/use-cases/find-analogs.use-case.js'

// ─────────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory `CatalogRepository` для теста. Хранит записи по `id`,
 * `findMedicinesByIds` возвращает в том же порядке, в котором они были
 * запрошены — это важно для предсказуемости в тестах сортировки.
 *
 * Все методы возвращают `Promise` через `Promise.resolve(...)` без `async`,
 * чтобы не плодить `require-await` lint-ошибки (правило `@typescript-eslint/
 * require-await`); реальные адаптеры делают `await` на сетевых вызовах,
 * здесь I/O нет.
 */
class FakeCatalogRepository implements CatalogRepository {
  private readonly store = new Map<string, MedicineRecord>()

  setRecord(record: MedicineRecord): void {
    this.store.set(record.id, record)
  }

  findMedicineById(id: string): Promise<MedicineRecord | null> {
    return Promise.resolve(this.store.get(id) ?? null)
  }

  findMedicinesByIds(ids: readonly string[]): Promise<MedicineRecord[]> {
    const out: MedicineRecord[] = []
    for (const id of ids) {
      const record = this.store.get(id)
      if (record !== undefined) out.push(record)
    }
    return Promise.resolve(out)
  }

  findCategoryTree(): Promise<readonly never[]> {
    return Promise.reject(new Error('not used in this test'))
  }

  findSubstancesByMedicineIds(): Promise<ReadonlyMap<string, never>> {
    return Promise.reject(new Error('not used in this test'))
  }

  save(): Promise<void> {
    return Promise.reject(new Error('not used in this test'))
  }
}

/** In-memory `AnalogCandidatesRepository` — возвращает то, что подложили. */
class FakeAnalogCandidatesRepository implements AnalogCandidatesRepository {
  private readonly responses = new Map<string, readonly string[]>()

  setResponse(referenceMedicineId: string, candidateIds: readonly string[]): void {
    this.responses.set(referenceMedicineId, candidateIds)
  }

  findCandidates(
    referenceMedicineId: string,
    _limit: number,
  ): Promise<readonly string[]> {
    return Promise.resolve(this.responses.get(referenceMedicineId) ?? [])
  }
}

/**
 * In-memory `AnalogOfferLookupPort`. Каждой паре `(medicineId, offerList)`
 * соответствует список офферов; lookup возвращает их в порядке, заданном
 * при настройке (тест контролирует «сортировку по цене ASC» явно).
 *
 * Контракт — `getOffersForMedicines({ medicineIds, geo, radiusMeters })`,
 * возвращает `Map<medicineId, PharmacyOfferPublic[]>` для тех medicineId,
 * у которых есть хотя бы один оффер.
 */
class FakeAnalogOfferLookup implements AnalogOfferLookupPort {
  public lastInput: AnalogOfferLookupInput | null = null
  private readonly offers = new Map<string, readonly PharmacyOfferPublic[]>()

  setOffers(medicineId: string, offers: readonly PharmacyOfferPublic[]): void {
    if (offers.length > 0) {
      this.offers.set(medicineId, offers)
    } else {
      this.offers.delete(medicineId)
    }
  }

  getOffersForMedicines(
    input: AnalogOfferLookupInput,
  ): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    this.lastInput = input
    const out = new Map<string, readonly PharmacyOfferPublic[]>()
    for (const id of input.medicineIds) {
      const list = this.offers.get(id)
      if (list !== undefined && list.length > 0) {
        out.set(id, list)
      }
    }
    return Promise.resolve(out)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const REFERENCE_ID = '00000000-0000-4000-8000-000000000001'
const CANDIDATE_A_ID = '00000000-0000-4000-8000-000000000002'
const CANDIDATE_B_ID = '00000000-0000-4000-8000-000000000003'

function makeRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  const base: MedicineRecord = {
    id: REFERENCE_ID,
    tradeName: 'Ref',
    innName: 'paracetamol',
    barcode: null,
    isGloballyIdentifiableByBarcode: false,
    categoryId: 1,
    dosageForm: 'tablet',
    dosageFormClass: 'tablet' as MedicineRecord['dosageFormClass'],
    dosageStrength: '500 mg',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'Test Pharma',
    isPrescriptionRequired: false,
    controlCategory: ControlCategory.none,
    isPublished: true,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    substances: [
      { substanceId: 'sub-paracetamol', strengthValue: 500, strengthUnit: DosageUnit.mg },
    ],
  }
  return { ...base, ...overrides }
}

function makeCandidateRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  return makeRecord({
    id: CANDIDATE_A_ID,
    tradeName: 'Candidate A',
    substances: [
      { substanceId: 'sub-paracetamol', strengthValue: 500, strengthUnit: DosageUnit.mg },
    ],
    ...overrides,
  })
}

/** Минимальный оффер с указанной ценой в дирамах. */
function makeOffer(overrides: Partial<PharmacyOfferPublic> = {}): PharmacyOfferPublic {
  return {
    pharmacyId: 'ph-1',
    priceDiram: 1000,
    distanceMeters: 500,
    isStale: false,
    lastSyncedAt: '2026-08-28T10:00:00Z',
    ...overrides,
  }
}

interface UseCaseHarness {
  readonly useCase: FindAnalogsUseCase
  readonly repo: FakeCatalogRepository
  readonly candidates: FakeAnalogCandidatesRepository
  readonly offers: FakeAnalogOfferLookup
}

function makeUseCase(seed: MedicineRecord[] = []): UseCaseHarness {
  const repo = new FakeCatalogRepository()
  const candidates = new FakeAnalogCandidatesRepository()
  const offers = new FakeAnalogOfferLookup()
  for (const r of seed) repo.setRecord(r)

  // DI-токены Symbol не могут быть переданы как DI через `@Inject` напрямую
  // — нужен инстанс через `useValue`. Здесь собираем use case руками.
  // Это корректно: тестируем use case, а не DI-граф NestJS.
  const useCase = new FindAnalogsUseCase(
    repo,
    candidates,
    offers,
  )
  return { useCase, repo, candidates, offers }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('FindAnalogsUseCase (DTJ-101, SRS-CAT-031..043, TC-CAT-013/014)', () => {
  it('1. TC-CAT-013: reference 8300, cheapest analog 1800 → savingsDiram = 6500 (целые дирамы, без округления)', async () => {
    const reference = makeRecord({ id: REFERENCE_ID, tradeName: 'Ref-Expensive' })
    const analog = makeCandidateRecord({
      id: CANDIDATE_A_ID,
      tradeName: 'Analog-Cheap',
      substances: [
        { substanceId: 'sub-paracetamol', strengthValue: 500, strengthUnit: DosageUnit.mg },
      ],
    })
    const { useCase, candidates, offers } = makeUseCase([reference, analog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    // Референс в радиусе за 8300 дирам (83 TJS), аналог за 1800 (18 TJS).
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 8300 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 1800 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.referenceMedicineId).toBe(REFERENCE_ID)
    expect(result.items.length).toBe(1)
    expect(result.items[0]!.medicineId).toBe(CANDIDATE_A_ID)
    expect(result.items[0]!.displayPrice).toBe(1800)
    expect(result.savingsDiram).toBe(6500)
  })

  it('2. TC-CAT-014: reference сам дешёвый → savingsDiram = null, items непустой', async () => {
    const reference = makeRecord({ id: REFERENCE_ID, tradeName: 'Ref-Cheapest' })
    const analog = makeCandidateRecord({
      id: CANDIDATE_A_ID,
      tradeName: 'Analog-Expensive',
      substances: [
        { substanceId: 'sub-paracetamol', strengthValue: 500, strengthUnit: DosageUnit.mg },
      ],
    })
    const { useCase, candidates, offers } = makeUseCase([reference, analog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    // Референс дешевле аналога → экономии нет.
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 1800 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 8300 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.items.length).toBe(1)
    expect(result.savingsDiram).toBeNull()
  })

  it('3. reference 8300, аналог 8300 (равны) → savingsDiram = null (не строго > 0)', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const analog = makeCandidateRecord({ id: CANDIDATE_A_ID })
    const { useCase, candidates, offers } = makeUseCase([reference, analog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 8300 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 8300 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.savingsDiram).toBeNull()
  })

  it('4. SQL-кандидаты есть, но домен отфильтровал всех → items:[], savingsDiram:null, ошибки нет', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    // Кандидат с другой формой (tablet vs capsule) — домен отфильтрует.
    const badCandidate = makeCandidateRecord({
      id: CANDIDATE_A_ID,
      dosageFormClass: 'capsule' as MedicineRecord['dosageFormClass'],
    })
    const { useCase, candidates, offers } = makeUseCase([reference, badCandidate])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    // Офферы есть, но они не должны быть запрошены — items пуст после domain-фильтра.
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 1000 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.items).toEqual([])
    expect(result.savingsDiram).toBeNull()
  })

  it('5. кандидатов нет вовсе (SQL вернул пусто) → items:[], savingsDiram:null', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const { useCase, candidates, offers } = makeUseCase([reference])
    candidates.setResponse(REFERENCE_ID, [])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 5000 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.items).toEqual([])
    expect(result.savingsDiram).toBeNull()
  })

  it('6. limit:1 на двух аналогах → items.length === 1, выбран самый дешёвый (SRS-DOM-158)', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const analogA = makeCandidateRecord({
      id: CANDIDATE_A_ID,
      tradeName: 'A',
    })
    const analogB = makeCandidateRecord({
      id: CANDIDATE_B_ID,
      tradeName: 'B',
    })
    const { useCase, candidates, offers } = makeUseCase([reference, analogA, analogB])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID, CANDIDATE_B_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 10000 })])
    // A — дешевле (2000), B — дороже (3000). Сортировка по цене ASC.
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 2000 })])
    offers.setOffers(CANDIDATE_B_ID, [makeOffer({ priceDiram: 3000 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID, limit: 1 })

    expect(result.items.length).toBe(1)
    expect(result.items[0]!.medicineId).toBe(CANDIDATE_A_ID)
    expect(result.savingsDiram).toBe(8000) // 10000 - 2000
  })

  it('7. limit:3 на двух аналогах → items.length === 2 (нет обрезки)', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const analogA = makeCandidateRecord({ id: CANDIDATE_A_ID })
    const analogB = makeCandidateRecord({ id: CANDIDATE_B_ID })
    const { useCase, candidates, offers } = makeUseCase([reference, analogA, analogB])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID, CANDIDATE_B_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 5000 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 1000 })])
    offers.setOffers(CANDIDATE_B_ID, [makeOffer({ priceDiram: 2000 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID, limit: 3 })

    expect(result.items.length).toBe(2)
  })

  it('8. референс не существует → MedicineNotFoundError (не NotFoundError, не generic Error)', async () => {
    const { useCase } = makeUseCase([])
    await expect(
      useCase.execute({ medicineId: '00000000-0000-4000-8000-000000000099' }),
    ).rejects.toBeInstanceOf(MedicineNotFoundError)
  })

  it('9. референс isPublished=false → MedicineNotFoundError (SRS-CAT-006, 404 не 422)', async () => {
    const draft = makeRecord({ isPublished: false })
    const { useCase } = makeUseCase([draft])
    await expect(useCase.execute({ medicineId: draft.id })).rejects.toBeInstanceOf(
      MedicineNotFoundError,
    )
  })

  it('10. референс controlCategory=psychotropic → MedicineNotFoundError', async () => {
    const forbidden = makeRecord({
      controlCategory: ControlCategory.psychotropic,
      isPrescriptionRequired: true,
    })
    const { useCase } = makeUseCase([forbidden])
    await expect(useCase.execute({ medicineId: forbidden.id })).rejects.toBeInstanceOf(
      MedicineNotFoundError,
    )
  })

  it('11. кандидат без офферов (setOffers не вызван) → аналог не попадает в items', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const analog = makeCandidateRecord({ id: CANDIDATE_A_ID })
    const { useCase, candidates, offers } = makeUseCase([reference, analog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 5000 })])
    // У CANDIDATE_A_ID офферов нет — аналог должен быть отфильтрован.

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.items).toEqual([])
    // savings: null — референс 5000, items нет, нечего сравнивать.
    expect(result.savingsDiram).toBeNull()
  })

  it('12. кандидат с isPublished=false (SQL не отфильтровал, race condition) → defense-in-depth отсекает', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const draftAnalog = makeCandidateRecord({
      id: CANDIDATE_A_ID,
      isPublished: false,
    })
    const { useCase, candidates, offers } = makeUseCase([reference, draftAnalog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 5000 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 1000 })])

    const result = await useCase.execute({ medicineId: REFERENCE_ID })

    expect(result.items).toEqual([])
  })

  it('13. референс и кандидаты идут в ОДНОМ батч-вызове порта (C15/производительность)', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const analog = makeCandidateRecord({ id: CANDIDATE_A_ID })
    const { useCase, candidates, offers } = makeUseCase([reference, analog])
    candidates.setResponse(REFERENCE_ID, [CANDIDATE_A_ID])
    offers.setOffers(REFERENCE_ID, [makeOffer({ priceDiram: 5000 })])
    offers.setOffers(CANDIDATE_A_ID, [makeOffer({ priceDiram: 1000 })])

    await useCase.execute({ medicineId: REFERENCE_ID })

    // Порт должен получить [REFERENCE_ID, CANDIDATE_A_ID] ОДНИМ вызовом.
    expect(offers.lastInput).not.toBeNull()
    expect(offers.lastInput!.medicineIds).toEqual([REFERENCE_ID, CANDIDATE_A_ID])
    expect(offers.lastInput!.radiusMeters).toBe(5000)
  })

  it('14. кастомный radiusMeters → пробрасывается в порт без изменений', async () => {
    const reference = makeRecord({ id: REFERENCE_ID })
    const { useCase, candidates, offers } = makeUseCase([reference])
    candidates.setResponse(REFERENCE_ID, [])

    await useCase.execute({ medicineId: REFERENCE_ID, radiusMeters: 2500 })

    expect(offers.lastInput!.radiusMeters).toBe(2500)
  })

  it('15. ANALOG_CANDIDATES_LIMIT экспортируется (= 50, именованная константа C6)', () => {
    expect(ANALOG_CANDIDATES_LIMIT).toBe(50)
  })
})

describe('FindAnalogsUseCase — DI-токены экспортируются (D-27)', () => {
  it('CATALOG_REPOSITORY / ANALOG_CANDIDATES_REPOSITORY / ANALOG_OFFER_LOOKUP_PORT — Symbol.for с уникальным ключом', () => {
    expect(typeof CATALOG_REPOSITORY).toBe('symbol')
    expect(typeof ANALOG_CANDIDATES_REPOSITORY).toBe('symbol')
    expect(typeof ANALOG_OFFER_LOOKUP_PORT).toBe('symbol')
    expect(CATALOG_REPOSITORY.toString()).toContain('catalog/catalog-repository')
    expect(ANALOG_CANDIDATES_REPOSITORY.toString()).toContain(
      'catalog/analog-candidates-repository',
    )
    expect(ANALOG_OFFER_LOOKUP_PORT.toString()).toContain(
      'catalog/analog-offer-lookup-port',
    )
  })
})