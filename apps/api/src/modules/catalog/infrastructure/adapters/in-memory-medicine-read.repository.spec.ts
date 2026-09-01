/**
 * Тест `InMemoryMedicineReadRepository` (DTJ-092, EP-04 / Волна 4) — фиксирует
 * контракт фильтрации и пагинации, чтобы Drizzle-адаптер в последующих тикетах
 * реализовал ТОЧНО ту же семантику.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6
 */
import { describe, expect, it } from 'vitest'
import { DosageForm, DosageFormClass, DosageUnit } from '@dorutj/domain-kernel'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import { Medicine, type MedicineCreateCommand } from '@/modules/catalog/domain/medicine.entity.js'
import { InMemoryMedicineReadRepository } from './in-memory-medicine-read.repository.js'

const SUBSTANCE_ID = '11111111-1111-1111-1111-111111111111'

const tabletFormResult = DosageForm.create(DosageFormClass.tablet)
if (!tabletFormResult.ok) {
  throw new Error('Test setup: tablet dosage form class is always valid')
}
const TABLET_FORM = tabletFormResult.value

interface MakeMedicineOptions {
  readonly id: string
  readonly categoryId: number
  readonly controlCategory: ControlCategory
  readonly isPublished?: boolean
}

function makeMedicine(opts: MakeMedicineOptions): Medicine {
  const cmd: MedicineCreateCommand = {
    id: opts.id,
    tradeName: `Medicine-${opts.id}`,
    innName: `INN-${opts.id}`,
    categoryId: opts.categoryId,
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
    substances: [
      { substanceId: SUBSTANCE_ID, strengthValue: 500, strengthUnit: DosageUnit.mg },
    ],
  }
  const result = Medicine.create(cmd)
  if (!result.ok) {
    throw new Error(`Test setup: cannot create medicine: ${result.error.message}`)
  }
  if (opts.isPublished === true) {
    // publish() возвращает Result с доменным событием; нас интересует только side-effect
    const published = result.value.publish(new Date('2026-01-01T00:00:00.000Z'))
    if (!published.ok) {
      throw new Error(`Test setup: cannot publish medicine: ${published.error.message}`)
    }
  }
  return result.value
}

describe('InMemoryMedicineReadRepository (DTJ-092, SRS-CAT-006)', () => {
  it('findById возвращает null для psychotropic (SRS-CAT-006)', async () => {
    const repo = new InMemoryMedicineReadRepository([
      makeMedicine({ id: 'id-1', categoryId: 1, controlCategory: ControlCategory.psychotropic, isPublished: true }),
    ])
    const result = await repo.findById('id-1')
    expect(result).toBeNull()
  })

  it('findById возвращает null для narcotic (SRS-CAT-006)', async () => {
    const repo = new InMemoryMedicineReadRepository([
      makeMedicine({ id: 'id-2', categoryId: 1, controlCategory: ControlCategory.narcotic, isPublished: true }),
    ])
    const result = await repo.findById('id-2')
    expect(result).toBeNull()
  })

  it('findById возвращает medicine для none + isPublished', async () => {
    const med = makeMedicine({ id: 'id-3', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true })
    const repo = new InMemoryMedicineReadRepository([med])
    const result = await repo.findById('id-3')
    expect(result).not.toBeNull()
    expect(result?.getId()).toBe('id-3')
  })

  it('findById возвращает null для несуществующего id', async () => {
    const repo = new InMemoryMedicineReadRepository([])
    const result = await repo.findById('does-not-exist')
    expect(result).toBeNull()
  })

  it('listByCategoryId фильтрует по categoryId, исключает psychotropic/narcotic, исключает неопубликованные', async () => {
    const repo = new InMemoryMedicineReadRepository([
      makeMedicine({ id: 'cat1-pub', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'cat1-pub-2', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'cat1-draft', categoryId: 1, controlCategory: ControlCategory.none, isPublished: false }),
      makeMedicine({ id: 'cat2-pub', categoryId: 2, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'cat1-psych', categoryId: 1, controlCategory: ControlCategory.psychotropic, isPublished: true }),
    ])
    const result = await repo.listByCategoryId(1, { limit: 100, offset: 0 })
    const ids = result.map((m) => m.getId()).sort()
    expect(ids).toEqual(['cat1-pub', 'cat1-pub-2'])
  })

  it('listByCategoryId применяет пагинацию (limit + offset)', async () => {
    const repo = new InMemoryMedicineReadRepository([
      makeMedicine({ id: 'm-1', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'm-2', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'm-3', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
    ])
    const page1 = await repo.listByCategoryId(1, { limit: 2, offset: 0 })
    const page2 = await repo.listByCategoryId(1, { limit: 2, offset: 2 })
    expect(page1).toHaveLength(2)
    expect(page2).toHaveLength(1)
  })

  it('listPublished возвращает все опубликованные без psychotropic/narcotic, из всех категорий', async () => {
    const repo = new InMemoryMedicineReadRepository([
      makeMedicine({ id: 'p-1', categoryId: 1, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'p-2', categoryId: 2, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'p-3', categoryId: 3, controlCategory: ControlCategory.none, isPublished: true }),
      makeMedicine({ id: 'p-psych', categoryId: 1, controlCategory: ControlCategory.psychotropic, isPublished: true }),
      makeMedicine({ id: 'p-draft', categoryId: 1, controlCategory: ControlCategory.none, isPublished: false }),
    ])
    const result = await repo.listPublished({ limit: 100, offset: 0 })
    const ids = result.map((m) => m.getId()).sort()
    expect(ids).toEqual(['p-1', 'p-2', 'p-3'])
  })
})
