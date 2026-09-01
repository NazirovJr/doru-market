/**
 * Тест `CatalogFacade` (DTJ-096, EP-04, R1).
 *
 * Проверяемые ветки (см. критерии приёмки тикета):
 *   1. `getMedicineSnapshot`:
 *      - Частичное совпадение id (существующие + несуществующие) → возвращается Map
 *        только с существующими.
 *      - Пустой массив на входе → пустой Map на выходе.
 *   2. `getSubstances`:
 *      - Проброс формы данных без трансформации.
 *   3. `isVisible`:
 *      - Все 4 комбинации published × control_category из SRS-CAT-055 defense-in-depth:
 *        published + none → true
 *        published + prescriptionOnly → true
 *        published + potent → true
 *        published + psychotropic → false
 *        published + narcotic → false
 *        !published + none → false
 *   4. `resolveMedicineByComposite`:
 *      - Заглушка для DTJ-097 → бросает ошибку "not implemented".
 *
 * Репозиторий замокирован in-memory — unit-тест без БД.
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-096.md
 */
import { describe, expect, it } from 'vitest'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord, SubstanceRef } from '@/modules/catalog/domain/medicine.types.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import { CatalogFacadeImpl } from '@/modules/catalog/index.js'

/** Минимальный in-memory `CatalogRepository` для теста. */
class FakeCatalogRepository implements CatalogRepository {
  private readonly medicineStore = new Map<string, MedicineRecord>()
  private readonly substancesStore = new Map<string, readonly SubstanceRef[]>()

  setRecord(record: MedicineRecord): void {
    this.medicineStore.set(record.id, record)
  }

  setSubstances(medicineId: string, substances: readonly SubstanceRef[]): void {
    this.substancesStore.set(medicineId, substances)
  }

  findMedicineById(id: string): Promise<MedicineRecord | null> {
    return Promise.resolve(this.medicineStore.get(id) ?? null)
  }

  findMedicinesByIds(ids: readonly string[]): Promise<MedicineRecord[]> {
    if (ids.length === 0) return Promise.resolve([])
    const uniqueIds = Array.from(new Set(ids))
    const out: MedicineRecord[] = []
    for (const id of uniqueIds) {
      const record = this.medicineStore.get(id)
      if (record) out.push(record)
    }
    return Promise.resolve(out)
  }

  findCategoryTree(): Promise<readonly never[]> {
    throw new Error('not used in this test')
  }

  findSubstancesByMedicineIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SubstanceRef[]>> {
    if (ids.length === 0) return Promise.resolve(new Map())
    const uniqueIds = Array.from(new Set(ids))
    const out = new Map<string, readonly SubstanceRef[]>()
    for (const id of uniqueIds) {
      const substances = this.substancesStore.get(id) ?? []
      out.set(id, substances)
    }
    return Promise.resolve(out)
  }

  save(): Promise<void> {
    return Promise.resolve()
  }
}

function makeRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  const base: MedicineRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    tradeName: 'Test Medicine',
    innName: 'Test INN',
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
    substances: [],
  }
  return { ...base, ...overrides }
}

function makeSubstanceRef(overrides: Partial<SubstanceRef> = {}): SubstanceRef {
  const base: SubstanceRef = {
    substanceId: 'substance-1',
    innName: 'Paracetamol',
    strengthValue: 500,
    strengthUnit: 'mg',
  }
  return { ...base, ...overrides }
}

function makeFacade(repo: FakeCatalogRepository): CatalogFacadeImpl {
  return new CatalogFacadeImpl(repo)
}

describe('CatalogFacade (DTJ-096, SRS-CAT-051, SRS-CAT-064, SRS-DOM-107)', () => {
  describe('getMedicineSnapshot', () => {
    it('возвращает Map только с существующими id (несуществующие молча пропускаются)', async () => {
      const repo = new FakeCatalogRepository()
      const record1 = makeRecord({ id: 'med-1', tradeName: 'Medicine 1' })
      const record2 = makeRecord({ id: 'med-2', tradeName: 'Medicine 2' })
      repo.setRecord(record1)
      repo.setRecord(record2)

      const facade = makeFacade(repo)

      const result = await facade.getMedicineSnapshot(['med-1', 'med-999', 'med-2'])

      expect(result.size).toBe(2)
      expect(result.has('med-1')).toBe(true)
      expect(result.has('med-2')).toBe(true)
      expect(result.has('med-999')).toBe(false)
      expect(result.get('med-1')?.tradeName).toBe('Medicine 1')
      expect(result.get('med-2')?.tradeName).toBe('Medicine 2')
    })

    it('пустой массив на входе → пустой Map на выходе', async () => {
      const repo = new FakeCatalogRepository()
      const facade = makeFacade(repo)

      const result = await facade.getMedicineSnapshot([])

      expect(result.size).toBe(0)
    })

    it('снимок содержит все обязательные поля (SRS-DOM-107)', async () => {
      const repo = new FakeCatalogRepository()
      const record = makeRecord({
        id: 'med-1',
        tradeName: 'Aspirin',
        innName: 'Acetylsalicylic acid',
        dosageForm: 'tablet',
        dosageStrength: '500 mg',
        isPrescriptionRequired: false,
        controlCategory: ControlCategory.none,
      })
      repo.setRecord(record)

      const facade = makeFacade(repo)

      const result = await facade.getMedicineSnapshot(['med-1'])
      const snapshot = result.get('med-1')!

      expect(snapshot.medicineId).toBe('med-1')
      expect(snapshot.tradeName).toBe('Aspirin')
      expect(snapshot.innName).toBe('Acetylsalicylic acid')
      expect(snapshot.dosageForm).toBe('tablet')
      expect(snapshot.dosageStrength).toBe('500 mg')
      expect(snapshot.isPrescriptionRequired).toBe(false)
      expect(snapshot.controlCategory).toBe(ControlCategory.none)
      // Цена НЕ включается — принадлежит inventory (SRS-DOM-107)
      expect('price' in snapshot).toBe(false)
    })
  })

  describe('getSubstances', () => {
    it('пробрасывает форму данных без трансформации (Map<medicineId, SubstanceRef[]>)', async () => {
      const repo = new FakeCatalogRepository()
      repo.setSubstances('med-1', [
        makeSubstanceRef({ substanceId: 'sub-1', innName: 'Paracetamol', strengthValue: 500, strengthUnit: 'mg' }),
        makeSubstanceRef({ substanceId: 'sub-2', innName: 'Caffeine', strengthValue: 50, strengthUnit: 'mg' }),
      ])
      repo.setSubstances('med-2', [
        makeSubstanceRef({ substanceId: 'sub-3', innName: 'Ibuprofen', strengthValue: 200, strengthUnit: 'mg' }),
      ])

      const facade = makeFacade(repo)

      const result = await facade.getSubstances(['med-1', 'med-2'])

      expect(result.size).toBe(2)
      const med1Substances = result.get('med-1')!
      const med2Substances = result.get('med-2')!
      expect(med1Substances).toHaveLength(2)
      expect(med2Substances).toHaveLength(1)
      expect(med1Substances[0]!.innName).toBe('Paracetamol')
      expect(med1Substances[1]!.innName).toBe('Caffeine')
      expect(med2Substances[0]!.innName).toBe('Ibuprofen')
    })

    it('пустой массив на входе → пустой Map на выходе', async () => {
      const repo = new FakeCatalogRepository()
      const facade = makeFacade(repo)

      const result = await facade.getSubstances([])

      expect(result.size).toBe(0)
    })

    it('несуществующий medicineId → пустой массив веществ (не ошибка)', async () => {
      const repo = new FakeCatalogRepository()
      const facade = makeFacade(repo)

      const result = await facade.getSubstances(['med-999'])

      expect(result.size).toBe(1)
      expect(result.get('med-999')).toEqual([])
    })
  })

  describe('isVisible (SRS-CAT-064, SRS-CAT-055 defense-in-depth)', () => {
    it('published + controlCategory=none → true', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({ id: 'med-1', isPublished: true, controlCategory: ControlCategory.none }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(true)
    })

    it('published + controlCategory=prescriptionOnly → true', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({
        id: 'med-1',
        isPublished: true,
        controlCategory: ControlCategory.prescriptionOnly,
        isPrescriptionRequired: true,
      }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(true)
    })

    it('published + controlCategory=potent → true', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({
        id: 'med-1',
        isPublished: true,
        controlCategory: ControlCategory.potent,
        isPrescriptionRequired: true,
      }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(true)
    })

    it('published + controlCategory=psychotropic → false (даже при isPublished=true)', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({
        id: 'med-1',
        isPublished: true,
        controlCategory: ControlCategory.psychotropic,
        isPrescriptionRequired: true,
      }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(false)
    })

    it('published + controlCategory=narcotic → false (даже при isPublished=true)', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({
        id: 'med-1',
        isPublished: true,
        controlCategory: ControlCategory.narcotic,
        isPrescriptionRequired: true,
      }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(false)
    })

    it('!published + controlCategory=none → false', async () => {
      const repo = new FakeCatalogRepository()
      repo.setRecord(makeRecord({ id: 'med-1', isPublished: false, controlCategory: ControlCategory.none }))
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-1')).toBe(false)
    })

    it('несуществующий medicineId → false', async () => {
      const repo = new FakeCatalogRepository()
      const facade = makeFacade(repo)

      expect(await facade.isVisible('med-999')).toBe(false)
    })
  })

  describe('resolveMedicineByComposite (DTJ-097 заглушка)', () => {
    it('бросает ошибку "not implemented" (заглушка для DTJ-097)', async () => {
      const repo = new FakeCatalogRepository()
      const facade = makeFacade(repo)

      await expect(
        facade.resolveMedicineByComposite({
          rawBarcode: null,
          rawTradeName: 'Test',
          rawDosageForm: null,
          rawDosageStrength: null,
          rawManufacturerName: null,
        }),
      ).rejects.toThrow('resolveMedicineByComposite not implemented yet (DTJ-097)')
    })
  })
})