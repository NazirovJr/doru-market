/**
 * Тест `ProposeControlCategoryUseCase` (DTJ-096, EP-04, R1).
 *
 * Проверяемые ветки (см. критерии приёмки тикета):
 *   1. Успешное предложение смены категории: препарат найден, категория отличается
 *      от текущей → сохраняется, возвращается событие `NewControlCategoryCandidateEvent`.
 *   2. Несуществующий `medicineId` → `NotFoundError` (`ErrorCode.NOT_FOUND`, маппится в 404).
 *   3. Предложенная категория равна текущей → `ControlCategoryChangeRequiresModerationError`.
 *
 * Репозиторий замокирован in-memory — unit-тест без БД. `UnitOfWork` (волна 6, найдено аудитом
 * того же дефекта, что чинили в checkout DTJ-231/233) БОЛЬШЕ НЕ ИНЖЕКТИРУЕТСЯ — прежняя
 * `unitOfWork.run(async (_tx) => {...})` была декоративной (`_tx` не использовался ни одним
 * вызовом), убрана целиком (см. JSDoc use case'а). Тест «5. UnitOfWork.run вызывается» удалён —
 * он проверял поведение, которое теперь намеренно отсутствует.
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-096.md
 */
import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import { DosageUnit } from '@dorutj/domain-kernel'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import { ProposeControlCategoryUseCase } from '@/modules/catalog/application/use-cases/propose-control-category.use-case.js'
import { ControlCategoryChangeRequiresModerationError } from '@/modules/catalog/domain/errors/control-category-change-requires-moderation.error.js'

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
    isPrescriptionRequired: true, // требуется для potent/psychotropic/narcotic
    controlCategory: ControlCategory.none,
    isPublished: true,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    substances: [
      {
        substanceId: 'substance-1',
        strengthValue: 500,
        strengthUnit: DosageUnit.mg,
      },
    ],
  }
  return { ...base, ...overrides }
}

function makeUseCase(repo: FakeCatalogRepository): ProposeControlCategoryUseCase {
  return new ProposeControlCategoryUseCase(repo)
}

describe('ProposeControlCategoryUseCase (DTJ-096, SRS-DOM-014, SRS-CAT-064)', () => {
  it('1. успешное предложение смены категории: препарат найден, категория отличается → возвращается событие', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({ controlCategory: ControlCategory.none })
    repo.setRecord(record)

    const useCase = makeUseCase(repo)

    const result = await useCase.execute({
      medicineId: record.id,
      proposedCategory: ControlCategory.prescriptionOnly,
      actorId: 'actor-123',
    })

    expect(result.medicineId).toBe(record.id)
    expect(result.proposedCategory).toBe(ControlCategory.prescriptionOnly)
    expect(result.event).toBeDefined()
    expect(result.event.medicineId).toBe(record.id)
    expect(result.event.proposedCategory).toBe(ControlCategory.prescriptionOnly)
    expect(result.event.actorId).toBe('actor-123')
    expect(result.event.proposedAt).toBeDefined()
  })

  it('2. несуществующий medicineId → NotFoundError (404)', async () => {
    const repo = new FakeCatalogRepository()
    const useCase = makeUseCase(repo)

    await expect(
      useCase.execute({
        medicineId: '00000000-0000-4000-8000-000000000099',
        proposedCategory: ControlCategory.prescriptionOnly,
        actorId: 'actor-123',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('3. предложенная категория равна текущей → ControlCategoryChangeRequiresModerationError', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({ controlCategory: ControlCategory.prescriptionOnly })
    repo.setRecord(record)

    const useCase = makeUseCase(repo)

    await expect(
      useCase.execute({
        medicineId: record.id,
        proposedCategory: ControlCategory.prescriptionOnly,
        actorId: 'actor-123',
      }),
    ).rejects.toBeInstanceOf(ControlCategoryChangeRequiresModerationError)
  })

  it('4. вызывает CatalogRepository.save после успешного предложения', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({ controlCategory: ControlCategory.none })
    repo.setRecord(record)

    const saveSpy = vi.spyOn(repo, 'save')

    const useCase = makeUseCase(repo)

    await useCase.execute({
      medicineId: record.id,
      proposedCategory: ControlCategory.prescriptionOnly,
      actorId: 'actor-123',
    })

    expect(saveSpy).toHaveBeenCalledOnce()
  })

  it('6. можно предложить potent (требует isPrescriptionRequired=true)', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({
      controlCategory: ControlCategory.none,
      isPrescriptionRequired: true,
    })
    repo.setRecord(record)

    const useCase = makeUseCase(repo)

    const result = await useCase.execute({
      medicineId: record.id,
      proposedCategory: ControlCategory.potent,
      actorId: 'actor-123',
    })

    expect(result.proposedCategory).toBe(ControlCategory.potent)
  })

  it('7. можно предложить psychotropic (требует isPrescriptionRequired=true)', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({
      controlCategory: ControlCategory.none,
      isPrescriptionRequired: true,
    })
    repo.setRecord(record)

    const useCase = makeUseCase(repo)

    const result = await useCase.execute({
      medicineId: record.id,
      proposedCategory: ControlCategory.psychotropic,
      actorId: 'actor-123',
    })

    expect(result.proposedCategory).toBe(ControlCategory.psychotropic)
  })

  it('8. можно предложить narcotic (требует isPrescriptionRequired=true)', async () => {
    const repo = new FakeCatalogRepository()
    const record = makeRecord({
      controlCategory: ControlCategory.none,
      isPrescriptionRequired: true,
    })
    repo.setRecord(record)

    const useCase = makeUseCase(repo)

    const result = await useCase.execute({
      medicineId: record.id,
      proposedCategory: ControlCategory.narcotic,
      actorId: 'actor-123',
    })

    expect(result.proposedCategory).toBe(ControlCategory.narcotic)
  })
})