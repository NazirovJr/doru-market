/**
 * Тест `PublishMedicineUseCase` (DTJ-096, EP-04, R1).
 *
 * Проверяемые ветки (см. критерии приёмки тикета):
 *   1. Успешная публикация: препарат найден, есть вещества → сохраняется, возвращается событие.
 *   2. Несуществующий `medicineId` → `NotFoundError` (`ErrorCode.NOT_FOUND`, маппится в 404).
 *   3. Препарат без действующих веществ → `MissingSubstancesError` пробрасывается наружу.
 *
 * Репозиторий и UnitOfWork замокированы in-memory — unit-тест без БД.
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-096.md
 */
import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import { DosageUnit } from '@dorutj/domain-kernel'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { PublishMedicineUseCase } from '@/modules/catalog/application/use-cases/publish-medicine.use-case.js'
import { MissingSubstancesError } from '@/modules/catalog/domain/errors/missing-substances.error.js'

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

/** Минимальный in-memory `UnitOfWorkPort` для теста — выполняет колбэк синхронно. */
class FakeUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: (tx: never) => Promise<T>): Promise<T> {
    // В тестах tx не используется
    return callback(undefined as never)
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
    isPublished: false, // не опубликован изначально
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    // Важно: есть хотя бы одно действующее вещество
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

function makeUseCase(
  repo: FakeCatalogRepository,
  uow: FakeUnitOfWork,
): PublishMedicineUseCase {
  return new PublishMedicineUseCase(repo, uow)
}

describe('PublishMedicineUseCase (DTJ-096, SRS-DOM-013, SRS-CAT-064)', () => {
  it('1. успешная публикация: препарат найден, есть вещества → сохраняется, возвращается событие', async () => {
    const repo = new FakeCatalogRepository()
    const uow = new FakeUnitOfWork()
    const record = makeRecord({ isPublished: false })
    repo.setRecord(record)

    const useCase = makeUseCase(repo, uow)

    const result = await useCase.execute({
      medicineId: record.id,
      actorId: 'actor-123',
    })

    expect(result.medicineId).toBe(record.id)
    expect(result.publishedAt).toBeDefined()
    expect(result.event).toBeDefined()
    expect(result.event.medicineId).toBe(record.id)
    expect(result.event.publishedAt).toBe(result.publishedAt)
  })

  it('2. несуществующий medicineId → NotFoundError (404)', async () => {
    const repo = new FakeCatalogRepository()
    const uow = new FakeUnitOfWork()
    const useCase = makeUseCase(repo, uow)

    await expect(
      useCase.execute({
        medicineId: '00000000-0000-4000-8000-000000000099',
        actorId: 'actor-123',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('3. препарат без действующих веществ → MissingSubstancesError пробрасывается наружу', async () => {
    const repo = new FakeCatalogRepository()
    const uow = new FakeUnitOfWork()
    // Препарат БЕЗ веществ
    const record = makeRecord({ substances: [] })
    repo.setRecord(record)

    const useCase = makeUseCase(repo, uow)

    await expect(
      useCase.execute({
        medicineId: record.id,
        actorId: 'actor-123',
      }),
    ).rejects.toBeInstanceOf(MissingSubstancesError)
  })

  it('4. вызывает CatalogRepository.save после успешной публикации', async () => {
    const repo = new FakeCatalogRepository()
    const uow = new FakeUnitOfWork()
    const record = makeRecord({ isPublished: false })
    repo.setRecord(record)

    const saveSpy = vi.spyOn(repo, 'save')

    const useCase = makeUseCase(repo, uow)

    await useCase.execute({
      medicineId: record.id,
      actorId: 'actor-123',
    })

    expect(saveSpy).toHaveBeenCalledOnce()
  })

  it('5. UnitOfWork.run вызывается (транзакционность)', async () => {
    const repo = new FakeCatalogRepository()
    const uow = new FakeUnitOfWork()
    const record = makeRecord({ isPublished: false })
    repo.setRecord(record)

    const runSpy = vi.spyOn(uow, 'run')

    const useCase = makeUseCase(repo, uow)

    await useCase.execute({
      medicineId: record.id,
      actorId: 'actor-123',
    })

    expect(runSpy).toHaveBeenCalledOnce()
  })
})