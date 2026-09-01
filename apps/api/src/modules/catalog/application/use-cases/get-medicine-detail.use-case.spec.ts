/**
 * Тест `GetMedicineDetailUseCase` (DTJ-095, EP-04 / Волна 4).
 *
 * Проверяемые ветки (см. критерии приёмки тикета):
 *   1. Несуществующий `medicineId` → `NotFoundError` (`ErrorCode.NOT_FOUND`, маппится в 404).
 *   2. `isPublished = false` (черновик) → `NotFoundError` для обычного клиента.
 *      `bypassVisibilityCheck = true` (роль super_admin) → запись возвращается с `isPublished = false`.
 *   3. `controlCategory = psychotropic`/`narcotic` → `NotFoundError` (НЕ 422, SRS-CAT-006).
 *      `bypassVisibilityCheck = true` → запись возвращается.
 *   4. Резолв fallback описания (4 комбинации `tj/ru` × заполнено/пусто).
 *   5. `hasAnalogs: false`, `offers: []` (TODO-стаб для DTJ-101, EP-07).
 *
 * Репозиторий замокирован in-memory — unit-тест без БД.
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-095.md
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2
 */
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import {
  GetMedicineDetailUseCase,
  resolveDescription,
} from '@/modules/catalog/application/use-cases/get-medicine-detail.use-case.js'

/** Минимальный in-memory `CatalogRepository` для теста. */
class FakeCatalogRepository implements CatalogRepository {
  private readonly store = new Map<string, MedicineRecord>()

  setRecord(record: MedicineRecord): void {
    this.store.set(record.id, record)
  }

  findMedicineById(id: string): Promise<MedicineRecord | null> {
    return Promise.resolve(this.store.get(id) ?? null)
  }

  findMedicinesByIds(): Promise<MedicineRecord[]> {
    throw new Error('not used in this test')
  }

  findCategoryTree(): Promise<readonly never[]> {
    throw new Error('not used in this test')
  }

  findSubstancesByMedicineIds(): Promise<ReadonlyMap<string, never>> {
    throw new Error('not used in this test')
  }

  save(): Promise<void> {
    throw new Error('not used in this test')
  }
}

function makeRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  const base: MedicineRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    tradeName: 'Test Trade',
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

function makeUseCase(seed: MedicineRecord[] = []): {
  readonly useCase: GetMedicineDetailUseCase
  readonly repo: FakeCatalogRepository
} {
  const repo = new FakeCatalogRepository()
  for (const r of seed) repo.setRecord(r)
  return { useCase: new GetMedicineDetailUseCase(repo), repo }
}

describe('GetMedicineDetailUseCase (DTJ-095, SRS-CAT-005/006/008/049/050)', () => {
  it('1. несуществующий medicineId → NotFoundError (404)', async () => {
    const { useCase } = makeUseCase()
    await expect(
      useCase.execute({
        medicineId: '00000000-0000-4000-8000-000000000099',
        locale: 'tj',
        bypassVisibilityCheck: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('2a. isPublished=false для обычного клиента → NotFoundError (404, не 422)', async () => {
    const record = makeRecord({ isPublished: false })
    const { useCase } = makeUseCase([record])
    await expect(
      useCase.execute({
        medicineId: record.id,
        locale: 'tj',
        bypassVisibilityCheck: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('2b. isPublished=false с bypassVisibilityCheck=true → запись возвращается', async () => {
    const record = makeRecord({ isPublished: false })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: true,
    })
    expect(detail.record.id).toBe(record.id)
    expect(detail.record.isPublished).toBe(false)
  })

  it('3a. controlCategory=psychotropic для анонима → NotFoundError (SRS-CAT-006, не 422)', async () => {
    const record = makeRecord({ controlCategory: ControlCategory.psychotropic })
    const { useCase } = makeUseCase([record])
    await expect(
      useCase.execute({
        medicineId: record.id,
        locale: 'tj',
        bypassVisibilityCheck: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('3b. controlCategory=narcotic для анонима → NotFoundError (SRS-CAT-006)', async () => {
    const record = makeRecord({ controlCategory: ControlCategory.narcotic })
    const { useCase } = makeUseCase([record])
    await expect(
      useCase.execute({
        medicineId: record.id,
        locale: 'tj',
        bypassVisibilityCheck: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('3c. controlCategory=psychotropic с bypassVisibilityCheck=true → запись возвращается', async () => {
    const record = makeRecord({
      controlCategory: ControlCategory.psychotropic,
      isPrescriptionRequired: true,
    })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: true,
    })
    expect(detail.record.controlCategory).toBe(ControlCategory.psychotropic)
  })

  it('4a. locale=tj: description_tj заполнено → возвращается оно', async () => {
    const record = makeRecord({
      descriptionTj: 'Сироп от кашля',
      descriptionRu: 'Сироп от кашля по-русски',
    })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: false,
    })
    expect(detail.description).toBe('Сироп от кашля')
  })

  it('4b. locale=tj: description_tj пусто, description_ru заполнено → fallback на ru (SRS-CAT-008)', async () => {
    const record = makeRecord({
      descriptionTj: null,
      descriptionRu: 'Сироп от кашля по-русски',
    })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: false,
    })
    expect(detail.description).toBe('Сироп от кашля по-русски')
  })

  it('4c. locale=tj: оба описания пусты → description: null', async () => {
    const record = makeRecord({ descriptionTj: null, descriptionRu: null })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: false,
    })
    expect(detail.description).toBeNull()
  })

  it('4d. locale=ru: description_ru заполнено → оно; пустое " " трактуется как null', async () => {
    const record = makeRecord({
      descriptionTj: 'тадж',
      descriptionRu: '   ',
    })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'ru',
      bypassVisibilityCheck: false,
    })
    expect(detail.description).toBeNull()
  })

  it('4e. locale=ru: description_ru заполнено → возвращается оно', async () => {
    const record = makeRecord({
      descriptionTj: 'тадж',
      descriptionRu: 'русское описание',
    })
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'ru',
      bypassVisibilityCheck: false,
    })
    expect(detail.description).toBe('русское описание')
  })

  it('5a. offers и hasAnalogs — TODO-стабы для DTJ-101 (пустой массив и false)', async () => {
    const record = makeRecord()
    const { useCase } = makeUseCase([record])
    const detail = await useCase.execute({
      medicineId: record.id,
      locale: 'tj',
      bypassVisibilityCheck: false,
    })
    expect(detail.offers).toEqual([])
    expect(detail.hasAnalogs).toBe(false)
  })
})

describe('resolveDescription (DTJ-095, SRS-CAT-008)', () => {
  it('locale=tj, оба пусто → null', () => {
    expect(resolveDescription('tj', null, null)).toBeNull()
  })

  it('locale=tj, tj заполнено → tj', () => {
    expect(resolveDescription('tj', 'тадж текст', 'рус текст')).toBe('тадж текст')
  })

  it('locale=tj, tj пусто (""), ru заполнено → ru', () => {
    expect(resolveDescription('tj', '', 'рус текст')).toBe('рус текст')
  })

  it('locale=tj, tj пробелы, ru заполнено → ru', () => {
    expect(resolveDescription('tj', '   ', 'рус текст')).toBe('рус текст')
  })

  it('locale=ru, ru пусто → null', () => {
    expect(resolveDescription('ru', 'тадж текст', null)).toBeNull()
  })

  it('locale=ru, ru заполнено → ru', () => {
    expect(resolveDescription('ru', 'тадж текст', 'рус текст')).toBe('рус текст')
  })
})