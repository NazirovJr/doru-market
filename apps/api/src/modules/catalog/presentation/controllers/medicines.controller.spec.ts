/**
 * Тест `MedicinesController.getById` (DTJ-095) — детальная карточка товара.
 *
 * Проверяемые ветки:
 *   1. Успешный сценарий — возвращает `{ data: MedicineDetailDto }` с полным набором SRS-CAT-049.
 *   2. `locale=ru` корректно резолвится и попадает в use case.
 *   3. Невалидный `locale` тихо фолбэчит на `tj`, а не падает 400.
 *   4. Несуществующий id → `NotFoundError` (404, не 422).
 *   5. Use case бросил `NotFoundError` для psychotropic/narcotic — контроллер пробрасывает.
 *
 * Use case замокирован — это unit-тест контроллера, без БД и без DI-контейнера.
 *
 * @see docs/spec/20-module-catalog-search.md SRS-CAT-049
 */
import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type {
  GetMedicineDetailUseCase,
  MedicineDetail,
} from '@/modules/catalog/application/use-cases/get-medicine-detail.use-case.js'
import type { ListMedicinesUseCase } from '@/modules/catalog/application/use-cases/list-medicines.use-case.js'
import { MedicinesController } from '@/modules/catalog/presentation/controllers/medicines.controller.js'

function makeRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  const base: MedicineRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    tradeName: 'Nurofen',
    innName: 'Ibuprofen',
    barcode: null,
    isGloballyIdentifiableByBarcode: false,
    categoryId: 1,
    dosageForm: 'tablet',
    dosageFormClass: 'tablet' as MedicineRecord['dosageFormClass'],
    dosageStrength: '200 mg',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'DoruTJ Pharma',
    isPrescriptionRequired: false,
    controlCategory: ControlCategory.none,
    isPublished: true,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: 'тадж',
    descriptionRu: 'рус',
    substances: [],
  }
  return { ...base, ...overrides }
}

/** Аргумент первого вызова замоканного `execute` (для теста перехвата). */
interface ExecuteArg {
  readonly medicineId: string
  readonly locale: 'tj' | 'ru'
  readonly radiusMeters?: number
  readonly geo?: { readonly lat: number; readonly lon: number }
  readonly bypassVisibilityCheck: boolean
}

function makeDetail(): MedicineDetail {
  return {
    record: makeRecord(),
    description: 'резолвнутое описание',
    offers: [],
    hasAnalogs: false,
  }
}

/**
 * Конструирует контроллер с mock'ом use case. Если `detailError` задан — `execute`
 * бросит его. Иначе вернёт `makeDetail()` (или переданный `detailResult`).
 *
 * Возвращает также spy-функцию `executeSpy`, через которую тесты могут
 * перехватить аргументы вызова. `vi.fn(...)` в vitest 4 возвращает `Mock`-генерик,
 * чей `.calls` нетипизирован по дизайну; мы аннотируем явно через `ExecuteArg`
 * чтобы избежать `any`-unsafe-*.
 */
function makeControllerWithMock(opts: {
  detailResult?: MedicineDetail
  detailError?: Error
}): {
  readonly controller: MedicinesController
  readonly executeSpy: (input: ExecuteArg) => Promise<MedicineDetail>
} {
  const executeSpy = vi.fn((_input: ExecuteArg): Promise<MedicineDetail> => {
    if (opts.detailError !== undefined) {
      return Promise.reject(opts.detailError)
    }
    return Promise.resolve(opts.detailResult ?? makeDetail())
  })
  const listMedicines = {} as ListMedicinesUseCase
  const controller = new MedicinesController(
    { execute: executeSpy } as unknown as GetMedicineDetailUseCase,
    listMedicines,
  )
  return { controller, executeSpy }
}

/**
 * Захватывает аргумент вызова use case через spy без `any`-unsafe доступа к
 * `mock.calls`. Тесты проверяют, что контроллер передал правильный `locale`.
 */
async function captureLocale(
  id: string,
  rawLocale: string | undefined,
): Promise<string | undefined> {
  const holder: { value: ExecuteArg | null } = { value: null }
  const executeSpy = vi.fn((input: ExecuteArg): Promise<MedicineDetail> => {
    holder.value = input
    return Promise.resolve(makeDetail())
  })
  const listMedicines = {} as ListMedicinesUseCase
  const controller = new MedicinesController(
    { execute: executeSpy } as unknown as GetMedicineDetailUseCase,
    listMedicines,
  )
  await controller.getById(id, rawLocale)
  // `holder.value` — это `ExecuteArg | null`, и его `locale` — конкретное
  // `'tj' | 'ru' | undefined` через опциональную цепочку.
  return holder.value === null ? undefined : holder.value.locale
}

describe('MedicinesController.getById (DTJ-095, SRS-CAT-049)', () => {
  it('1. возвращает { data: MedicineDetailDto } со всеми полями SRS-CAT-049', async () => {
    const { controller } = makeControllerWithMock({})
    const result = await controller.getById('00000000-0000-4000-8000-000000000001', 'tj')
    expect(result.data.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(result.data.tradeName).toBe('Nurofen')
    expect(result.data.dosageFormClass).toBe('tablet')
    expect(result.data.description).toBe('резолвнутое описание')
    expect(result.data.substances).toEqual([])
    expect(result.data.offers).toEqual([])
    expect(result.data.hasAnalogs).toBe(false)
  })

  it('2. передаёт locale=ru в use case (через capture)', async () => {
    const locale = await captureLocale('00000000-0000-4000-8000-000000000001', 'ru')
    expect(locale).toBe('ru')
  })

  it('3. невалидный locale фолбэчит на tj, не падает 400 (через capture)', async () => {
    const locale = await captureLocale('00000000-0000-4000-8000-000000000001', 'en')
    expect(locale).toBe('tj')
  })

  it('4. use case бросил NotFoundError — пробрасывается наверх', async () => {
    const { controller } = makeControllerWithMock({
      detailError: new NotFoundError({ resource: 'medicine' }),
    })
    await expect(
      controller.getById('00000000-0000-4000-8000-000000000099', 'tj'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('5. NotFoundError (из use case для psychotropic) → 404 пробрасывается (SRS-CAT-006)', async () => {
    // Семантически use case уже отфильтровал psychotropic/narcotic/draft в
    // `GetMedicineDetailUseCase.execute()`; контроллер только пробрасывает
    // ошибку. Подробная проверка контракта — в `get-medicine-detail.use-case.spec.ts`.
    const { controller } = makeControllerWithMock({
      detailError: new NotFoundError({ resource: 'medicine' }),
    })
    await expect(
      controller.getById('00000000-0000-4000-8000-000000000001', 'tj'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})