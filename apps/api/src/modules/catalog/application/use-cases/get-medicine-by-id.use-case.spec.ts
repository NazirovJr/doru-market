/**
 * Тест `GetMedicineByIdUseCase` (DTJ-095, SRS-CAT-006, D-08).
 *
 * Проверяемые ветки:
 *   1. Несуществующий `id` → `MedicineNotFoundError`.
 *   2. Найден, `controlCategory = none`, опубликован → возвращает `Medicine`.
 *   3. Найден, `controlCategory = narcotic` → `MedicineNotFoundError` (НЕ возврат записи),
 *      даже если репозиторий (по ошибке или до фикса своей защиты) её отдал —
 *      это defense-in-depth самого use case, а не только репозитория.
 *   4. То же для `controlCategory = psychotropic`.
 *   5. Найден, `controlCategory = none`, но `isPublished = false` → `MedicineNotFoundError`.
 *   6. Сообщение ошибки для «не найдено» и «найдено, но запрещено» неотличимо
 *      (один и тот же формат текста) — нельзя определить факт существования записи.
 *
 * Репозиторий в тесте — фейк, который сознательно НЕ фильтрует psychotropic/narcotic
 * (в отличие от `InMemoryMedicineReadRepository`), чтобы тест бил именно по проверке
 * внутри самого use case, а не по защите на уровне репозитория.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.1/3.2
 */
import { describe, expect, it } from 'vitest'
import { DosageForm, DosageFormClass, DosageUnit } from '@dorutj/domain-kernel'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import { Medicine, type MedicineCreateCommand } from '@/modules/catalog/domain/medicine.entity.js'
import type {
  ListMedicinesParams,
  MedicineReadRepository,
} from '@/modules/catalog/application/ports/medicine-read.repository.port.js'
import { MedicineNotFoundError } from '@/modules/catalog/domain/errors/medicine-not-found.error.js'
import { GetMedicineByIdUseCase } from '@/modules/catalog/application/use-cases/get-medicine-by-id.use-case.js'

const SUBSTANCE_ID = '11111111-1111-1111-1111-111111111111'

const tabletFormResult = DosageForm.create(DosageFormClass.tablet)
if (!tabletFormResult.ok) {
  throw new Error('Test setup: tablet dosage form class is always valid')
}
const TABLET_FORM = tabletFormResult.value

interface MakeMedicineOptions {
  readonly id: string
  readonly controlCategory: ControlCategory
  readonly isPublished?: boolean
}

function makeMedicine(opts: MakeMedicineOptions): Medicine {
  const cmd: MedicineCreateCommand = {
    id: opts.id,
    tradeName: `Medicine-${opts.id}`,
    innName: `INN-${opts.id}`,
    categoryId: 1,
    dosageForm: TABLET_FORM,
    dosageStrengthRaw: '500 мг',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'Test Pharma',
    isPrescriptionRequired: opts.controlCategory !== ControlCategory.none,
    controlCategory: opts.controlCategory,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    substances: [{ substanceId: SUBSTANCE_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
  }
  const result = Medicine.create(cmd)
  if (!result.ok) {
    throw new Error(`Test setup: cannot create medicine: ${result.error.message}`)
  }
  if (opts.isPublished === true) {
    const published = result.value.publish(new Date('2026-01-01T00:00:00.000Z'))
    if (!published.ok) {
      throw new Error(`Test setup: cannot publish medicine: ${published.error.message}`)
    }
  }
  return result.value
}

/**
 * Фейковый `MedicineReadRepository`, который НЕ фильтрует psychotropic/narcotic
 * (в отличие от реального `InMemoryMedicineReadRepository`) — нужен, чтобы тест
 * проверял защиту именно на уровне use case (defense-in-depth), а не полагался
 * на репозиторий.
 */
class UnfilteredFakeMedicineReadRepository implements MedicineReadRepository {
  private readonly store = new Map<string, Medicine>()

  setMedicine(medicine: Medicine): void {
    this.store.set(medicine.getId(), medicine)
  }

  findById(id: string): Promise<Medicine | null> {
    return Promise.resolve(this.store.get(id) ?? null)
  }

  listByCategoryId(_categoryId: number, _params: ListMedicinesParams): Promise<readonly Medicine[]> {
    throw new Error('not used in this test')
  }

  listPublished(_params: ListMedicinesParams): Promise<readonly Medicine[]> {
    throw new Error('not used in this test')
  }
}

describe('GetMedicineByIdUseCase (SRS-CAT-006, D-08)', () => {
  it('1. несуществующий id → MedicineNotFoundError', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const useCase = new GetMedicineByIdUseCase(repo)

    await expect(useCase.execute('does-not-exist')).rejects.toThrow(MedicineNotFoundError)
  })

  it('2. controlCategory=none, опубликован → возвращает Medicine', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const medicine = makeMedicine({ id: 'id-ok', controlCategory: ControlCategory.none, isPublished: true })
    repo.setMedicine(medicine)
    const useCase = new GetMedicineByIdUseCase(repo)

    const result = await useCase.execute('id-ok')

    expect(result.getId()).toBe('id-ok')
  })

  it('3. controlCategory=narcotic → MedicineNotFoundError, а не запись (SRS-CAT-006)', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const medicine = makeMedicine({ id: 'id-narcotic', controlCategory: ControlCategory.narcotic, isPublished: true })
    repo.setMedicine(medicine)
    const useCase = new GetMedicineByIdUseCase(repo)

    await expect(useCase.execute('id-narcotic')).rejects.toThrow(MedicineNotFoundError)
  })

  it('4. controlCategory=psychotropic → MedicineNotFoundError, а не запись (SRS-CAT-006)', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const medicine = makeMedicine({
      id: 'id-psychotropic',
      controlCategory: ControlCategory.psychotropic,
      isPublished: true,
    })
    repo.setMedicine(medicine)
    const useCase = new GetMedicineByIdUseCase(repo)

    await expect(useCase.execute('id-psychotropic')).rejects.toThrow(MedicineNotFoundError)
  })

  it('5. controlCategory=none, но isPublished=false → MedicineNotFoundError', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const medicine = makeMedicine({ id: 'id-draft', controlCategory: ControlCategory.none, isPublished: false })
    repo.setMedicine(medicine)
    const useCase = new GetMedicineByIdUseCase(repo)

    await expect(useCase.execute('id-draft')).rejects.toThrow(MedicineNotFoundError)
  })

  it('6. сообщение ошибки «не найдено» и «найдено, но запрещено» неотличимо', async () => {
    const repo = new UnfilteredFakeMedicineReadRepository()
    const medicine = makeMedicine({ id: 'id-narcotic-2', controlCategory: ControlCategory.narcotic, isPublished: true })
    repo.setMedicine(medicine)
    const useCase = new GetMedicineByIdUseCase(repo)

    const notFoundResult = await useCase.execute('truly-missing-id').catch((e: unknown) => e)
    const forbiddenResult = await useCase.execute('id-narcotic-2').catch((e: unknown) => e)

    expect(notFoundResult).toBeInstanceOf(MedicineNotFoundError)
    expect(forbiddenResult).toBeInstanceOf(MedicineNotFoundError)
    expect((notFoundResult as MedicineNotFoundError).message).toBe('Medicine not found: truly-missing-id')
    expect((forbiddenResult as MedicineNotFoundError).message).toBe('Medicine not found: id-narcotic-2')
  })
})
