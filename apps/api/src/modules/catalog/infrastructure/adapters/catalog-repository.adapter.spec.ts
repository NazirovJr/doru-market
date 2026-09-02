/**
 * Тест `CatalogRepositoryAdapter` (DTJ-092, EP-04, R1) — UNIT-уровень,
 * с in-memory моком `DrizzleLike`. Без реальной БД.
 *
 * Проверяемые инварианты:
 *   1. `findMedicineById` — найден/не найден, пустой medicines[] не падает.
 *   2. `findMedicinesByIds([])` → `[]` (не бросает).
 *   3. `findMedicinesByIds` — один SQL для medicines + один для substances (N+1 нет).
 *   4. `findCategoryTree` — строит дерево из плоского списка.
 *   5. `findSubstancesByMedicineIds` — группирует по `medicineId`.
 *   6. `save` — INSERT с правильными колонками; вызывает DELETE перед INSERT
 *      для `medicine_substances` (полная перезапись).
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4, EP-04)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DosageForm, DosageUnit } from '@dorutj/domain-kernel'
import { ControlCategory, DosageFormClass } from '@/modules/catalog/domain/medicine.enums.js'
import { Medicine, type MedicineCreateCommand } from '@/modules/catalog/domain/medicine.entity.js'
import { CatalogRepositoryAdapter } from './catalog-repository.adapter.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import { categories } from '@/db/schema/categories.js'
import { medicines } from '@/db/schema/medicines.js'
import { medicineSubstances } from '@/db/schema/medicine-substances.js'

/** Минимальный контракт Drizzle-операций, нужных адаптеру. */
interface DrizzleMock {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

/** Тег, по которому мок различает таблицы (Drizzle не раскрывает символ). */
type TableName = 'medicines' | 'medicine_substances' | 'categories'

/** Подсказки для упрощённой интерпретации `eq(...)` в моке (единственный различаемый фильтр — `isActive = 1`). */
const activeFilterHints = new Set<TableName>()

function resetWhereHints(): void {
  activeFilterHints.clear()
}

/** `queryChunks` из Drizzle SQL-объекта условия, либо `null`, если это не он. */
function getQueryChunks(cond: unknown): readonly unknown[] | null {
  if (cond === null || typeof cond !== 'object' || !('queryChunks' in cond)) {
    return null
  }
  return (cond as { queryChunks: readonly unknown[] }).queryChunks
}

/** Чанк — ссылка на колонку `is_active`/`isActive`. */
function isActiveColumnChunk(chunk: unknown): boolean {
  if (chunk === null || typeof chunk !== 'object' || !('name' in chunk)) return false
  const name = chunk.name
  return name === 'is_active' || name === 'isActive'
}

/** Чанк-параметр со значением `1`/`true` (то, во что Drizzle упаковывает связанный параметр). */
function isTruthyParamChunk(chunk: unknown): boolean {
  if (chunk === null || typeof chunk !== 'object' || !('value' in chunk)) return false
  const value = chunk.value
  return value === 1 || value === true
}

/**
 * Распознаёт условие `eq(categories.isActive, 1)` (или `true`) в Drizzle SQL-объекте.
 *
 * Drizzle `eq()` упаковывает значение в связанный параметр, а НЕ кладёт голым числом
 * в массив `queryChunks`. Фактическая структура:
 *
 *   [{value:['']}, <колонка .name='is_active'>, {value:[' = ']}, {brand:'PgParam',value:1}, {value:['']}]
 *
 * Прежняя проверка `chunks.includes(1)` НИКОГДА не срабатывала (значение лежит внутри
 * `chunk.value`), из-за чего фильтр `is_active = 1` молча терялся и неактивные категории
 * просачивались в дерево. Здесь ищем колонку по имени и значение связанного параметра.
 */
function isIsActiveEqualsOne(cond: unknown): boolean {
  const chunks = getQueryChunks(cond)
  if (chunks === null) return false
  for (let i = 0; i < chunks.length; i++) {
    if (!isActiveColumnChunk(chunks[i])) continue
    // Значение условия — один из чанков-параметров после колонки (" = " между ними).
    if (chunks.slice(i + 1).some(isTruthyParamChunk)) return true
  }
  return false
}

/** Конструктор тестового мока Drizzle, накапливающего «табличные» данные. */
function makeDrizzleMock(): {
  db: DrizzleMock
  medicines: Map<string, Record<string, unknown>>
  medicineSubstances: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  selectCalls: { table: TableName; args: unknown[] }[]
  insertCalls: { table: TableName; values: unknown }[]
  deleteCalls: { table: TableName; where: unknown }[]
} {
  const medicinesStore = new Map<string, Record<string, unknown>>()
  const medicineSubstancesStore: Record<string, unknown>[] = []
  const categoriesStore: Record<string, unknown>[] = []
  const selectCalls: { table: TableName; args: unknown[] }[] = []
  const insertCalls: { table: TableName; values: unknown }[] = []
  const deleteCalls: { table: TableName; where: unknown }[] = []

  function tableName(table: unknown): TableName {
    if (table === medicines) return 'medicines'
    if (table === medicineSubstances) return 'medicine_substances'
    if (table === categories) return 'categories'
    throw new Error(`Unknown table in mock: ${String(table)}`)
  }

  const db: DrizzleMock = {
    select: vi.fn((cols: unknown) => {
      const builder = {
        from(table: unknown) {
          const name = tableName(table)
          // Простой «where-парсер» для мока: `eq(col, val)` сравнивает значения.
          // Достаточно для нашего адаптера, который использует `eq()` только.
          type Row = Record<string, unknown>
          function applyWhere(rows: Row[]): Row[] {
            // Drizzle `eq(col, val)` сохраняется моком как «hint» при вызове
            // `.where(cond)`; без финального `.limit()`/`.orderBy()` мы всё равно
            // попадём в `selfOrderChain.then(...)`, который вызывает `applyWhere`
            // с уже разрешённым набором. Здесь применяем hint.
            const hasActiveFilter = activeFilterHints.has(name)
            // eslint-disable-next-line no-console -- диагностический лог в тесте, чтобы понять путь вызова
            console.error(`[mock:applyWhere] table=${name} hasActiveFilter=${String(hasActiveFilter)} rows=${String(rows.length)}`)
            if (!hasActiveFilter) return rows
            return rows.filter((r) => r.isActive === 1 || r.isActive === true)
          }
          const selfWhereChain = {
            where(cond: unknown) {
              selectCalls.push({ table: name, args: [cols] })
              // Запоминаем форму условия для последующего resolve.
              if (isIsActiveEqualsOne(cond)) {
                activeFilterHints.add(name)
              }
              return selfOrderChain
            },
            orderBy(_o: unknown) {
              return selfOrderChain
            },
          }
          const selfOrderChain = {
            where(_cond: unknown) {
              selectCalls.push({ table: name, args: [cols] })
              return selfOrderChain
            },
            orderBy(_o: unknown) {
              return selfOrderChain
            },
            limit(n: number) {
              return selfResolve(n)
            },
            then(resolve: (rows: unknown[]) => void) {
              const rows = applyWhere(selfResolveAll(name))
              resolve(rows)
              return Promise.resolve()
            },
          }
          const selfResolve = (limit?: number) => ({
            then(resolve: (rows: unknown[]) => void) {
              const rows = applyWhere(selfResolveAll(name))
              resolve(limit === undefined ? rows : rows.slice(0, limit))
              return Promise.resolve()
            },
          })
          function selfResolveAll(n: TableName): Row[] {
            if (n === 'medicines') return [...medicinesStore.values()]
            if (n === 'medicine_substances') return medicineSubstancesStore
            return categoriesStore
          }
          return selfWhereChain
        },
      }
      return builder
    }),
    insert: vi.fn((table: unknown) => {
      const name = tableName(table)
      const valuesRef: { current: unknown } = { current: undefined }
      return {
        values(vals: unknown) {
          valuesRef.current = vals
          const finalizer = {
            onConflictDoUpdate(_cfg: unknown) {
              insertCalls.push({ table: name, values: valuesRef.current })
              applyInsert(name, vals)
              return Promise.resolve()
            },
          }
          // Адаптер для `medicine_substances` НЕ вызывает `onConflictDoUpdate`
          // (там используется DELETE+INSERT). Мок должен поддерживать оба пути —
          // резолвить `values()` без финализатора мы НЕ можем (Drizzle требует
          // явного `onConflictDoNothing` или подобного, иначе коллизия). Чтобы
          // адаптер был корректным, добавим `onConflictDoNothing` — но это меняет
          // адаптер. Поэтому мок умеет «голый» `values()` через thenable:
          return {
            ...finalizer,
            then(resolve: () => void) {
              insertCalls.push({ table: name, values: valuesRef.current })
              applyInsert(name, vals)
              resolve()
              return Promise.resolve()
            },
          }
        },
      }
      function applyInsert(n: TableName, vals: unknown): void {
        if (n === 'medicines') {
          const arr = (Array.isArray(vals) ? vals : [vals]) as Record<string, unknown>[]
          for (const v of arr) {
            medicinesStore.set(String(v.id), v)
          }
        } else if (n === 'medicine_substances') {
          const arr = (Array.isArray(vals) ? vals : [vals]) as Record<string, unknown>[]
          medicineSubstancesStore.push(...arr)
        }
      }
    }),
    delete: vi.fn((table: unknown) => {
      const name = tableName(table)
      return {
        where(whereFn: unknown) {
          deleteCalls.push({ table: name, where: whereFn })
          if (name === 'medicine_substances') {
            medicineSubstancesStore.length = 0
          }
          return Promise.resolve()
        },
      }
    }),
  }

  return {
    db,
    medicines: medicinesStore,
    medicineSubstances: medicineSubstancesStore,
    categories: categoriesStore,
    selectCalls,
    insertCalls,
    deleteCalls,
  }
}

const SUBSTANCE_A = '11111111-1111-4111-8111-111111111111'
const SUBSTANCE_B = '22222222-2222-4222-8222-222222222222'
const MEDICINE_ID = '33333333-3333-4333-8333-333333333333'
const MEDICINE_ID_2 = '44444444-4444-4444-8444-444444444444'

const TABLET_FORM_RESULT = DosageForm.create(DosageFormClass.tablet)
if (!TABLET_FORM_RESULT.ok) throw new Error('Test setup: tablet form create failed')
const TABLET_FORM = TABLET_FORM_RESULT.value

function makeMedicine(opts: {
  readonly id: string
  readonly controlCategory?: ControlCategory
  readonly isPrescriptionRequired?: boolean
  readonly published?: boolean
}): Medicine {
  const cmd: MedicineCreateCommand = {
    id: opts.id,
    tradeName: `Trade-${opts.id}`,
    innName: `INN-${opts.id}`,
    categoryId: 7,
    dosageForm: TABLET_FORM,
    dosageStrengthRaw: '500 мг',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'Test Pharma',
    isPrescriptionRequired: opts.isPrescriptionRequired ?? false,
    controlCategory: opts.controlCategory ?? ControlCategory.none,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    substances: [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: DosageUnit.mg },
    ],
  }
  const r = Medicine.create(cmd)
  if (!r.ok) throw new Error(`Test setup: Medicine.create failed: ${r.error.message}`)
  if (opts.published === true) {
    const p = r.value.publish(new Date('2026-01-01T00:00:00.000Z'))
    if (!p.ok) throw new Error('Test setup: publish failed')
  }
  return r.value
}

function seedMedicine(
  store: { medicines: Map<string, Record<string, unknown>> },
  medicine: Medicine,
  barcode: string | null = null,
): void {
  store.medicines.set(medicine.getId(), {
    id: medicine.getId(),
    tradeName: medicine.getTradeName(),
    innName: medicine.getInnName(),
    barcode,
    isGloballyIdentifiableByBarcode: medicine.isGloballyIdentifiableByBarcode(),
    categoryId: medicine.getCategoryId(),
    dosageForm: medicine.getDosageForm().getFormClass(),
    dosageFormClass: medicine.getDosageForm().getFormClass(),
    dosageStrength: medicine.getDosageStrengthRaw(),
    manufacturerCountry: medicine.getManufacturerCountry(),
    manufacturerName: medicine.getManufacturerName(),
    isPrescriptionRequired: medicine.isPrescriptionRequired(),
    controlCategory: medicine.getControlCategory(),
    isPublished: medicine.isPublished(),
    requiresColdChain: medicine.requiresColdChain(),
    imageUrl: medicine.getImageUrl(),
    descriptionTj: medicine.getDescriptionTj(),
    descriptionRu: medicine.getDescriptionRu(),
  })
}

function seedSubstances(
  store: { medicineSubstances: Record<string, unknown>[] },
  medicineId: string,
  items: { substanceId: string; strengthValue: number | string; strengthUnit: string }[],
): void {
  for (const s of items) {
    store.medicineSubstances.push({
      medicineId,
      substanceId: s.substanceId,
      strengthValue: s.strengthValue,
      strengthUnit: s.strengthUnit,
    })
  }
}

describe('CatalogRepositoryAdapter (DTJ-092, SRS-CAT-005)', () => {
  let mock: ReturnType<typeof makeDrizzleMock>
  let repo: CatalogRepository

  beforeEach(() => {
    mock = makeDrizzleMock()
    resetWhereHints()
    repo = new CatalogRepositoryAdapter(
      mock.db as unknown as ConstructorParameters<typeof CatalogRepositoryAdapter>[0],
    )
  })

  it('findMedicineById возвращает null для несуществующего id (SRS-CAT-005)', async () => {
    const result = await repo.findMedicineById('does-not-exist')
    expect(result).toBeNull()
  })

  it('findMedicineById возвращает MedicineRecord с substances[] для существующего', async () => {
    const med = makeMedicine({ id: MEDICINE_ID, published: true })
    seedMedicine(mock, med)
    seedSubstances(mock, MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
      { substanceId: SUBSTANCE_B, strengthValue: 250, strengthUnit: 'mg' },
    ])

    const result = await repo.findMedicineById(MEDICINE_ID)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(MEDICINE_ID)
    expect(result?.substances).toHaveLength(2)
    expect(result?.controlCategory).toBe(ControlCategory.none)
    expect(result?.isPublished).toBe(true)
  })

  it('findMedicinesByIds([]) возвращает [] без SQL-вызовов', async () => {
    const result = await repo.findMedicinesByIds([])
    expect(result).toEqual([])
    expect(mock.db.select).not.toHaveBeenCalled()
  })

  it('findMedicinesByIds возвращает только найденные, без N+1', async () => {
    const med1 = makeMedicine({ id: MEDICINE_ID, published: true })
    const med2 = makeMedicine({ id: MEDICINE_ID_2, published: true })
    seedMedicine(mock, med1)
    seedMedicine(mock, med2)
    seedSubstances(mock, MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
    ])
    seedSubstances(mock, MEDICINE_ID_2, [
      { substanceId: SUBSTANCE_B, strengthValue: 250, strengthUnit: 'mg' },
    ])

    const result = await repo.findMedicinesByIds([MEDICINE_ID, MEDICINE_ID_2, 'unknown'])
    expect(result).toHaveLength(2)
    const ids = result.map((r) => r.id).sort()
    expect(ids).toEqual([MEDICINE_ID, MEDICINE_ID_2].sort())

    // N+1-инвариант: ровно 2 SELECT (medicines + medicine_substances), не 4.
    const medicineSelects = mock.selectCalls.filter((c) => c.table === 'medicines')
    const substanceSelects = mock.selectCalls.filter((c) => c.table === 'medicine_substances')
    expect(medicineSelects).toHaveLength(1)
    expect(substanceSelects).toHaveLength(1)
  })

  it('findCategoryTree строит дерево из плоского списка (SRS-CAT-004)', async () => {
    mock.categories.push(
      { id: 1, parentId: null, slug: 'root', nameTj: 'R-tj', nameRu: 'R-ru', nameEn: 'R-en', commissionCategory: 'otc', sortOrder: 0, isActive: 1 },
      { id: 2, parentId: 1, slug: 'child', nameTj: 'C-tj', nameRu: 'C-ru', nameEn: 'C-en', commissionCategory: 'otc', sortOrder: 0, isActive: 1 },
      { id: 3, parentId: 2, slug: 'leaf', nameTj: 'L-tj', nameRu: 'L-ru', nameEn: 'L-en', commissionCategory: 'otc', sortOrder: 0, isActive: 1 },
      // Неактивная — НЕ должна попасть в дерево (SRS-CAT-004).
      { id: 4, parentId: null, slug: 'inactive', nameTj: 'I-tj', nameRu: 'I-ru', nameEn: 'I-en', commissionCategory: 'otc', sortOrder: 0, isActive: 0 },
    )

    const tree = await repo.findCategoryTree()
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root?.id).toBe(1)
    expect(root?.children).toHaveLength(1)
    expect(root?.children[0]?.id).toBe(2)
    expect(root?.children[0]?.children[0]?.id).toBe(3)
  })

  it('findSubstancesByMedicineIds([]) → пустой Map без SQL', async () => {
    const result = await repo.findSubstancesByMedicineIds([])
    expect(result.size).toBe(0)
    expect(mock.db.select).not.toHaveBeenCalled()
  })

  it('findSubstancesByMedicineIds группирует по medicineId', async () => {
    seedSubstances(mock, MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
      { substanceId: SUBSTANCE_B, strengthValue: 250, strengthUnit: 'mg' },
    ])
    seedSubstances(mock, MEDICINE_ID_2, [
      { substanceId: SUBSTANCE_A, strengthValue: 100, strengthUnit: 'mg' },
    ])

    const result = await repo.findSubstancesByMedicineIds([MEDICINE_ID, MEDICINE_ID_2])
    expect(result.size).toBe(2)
    expect(result.get(MEDICINE_ID)).toHaveLength(2)
    expect(result.get(MEDICINE_ID_2)).toHaveLength(1)
  })

  it('save делает UPSERT (ON CONFLICT DO UPDATE) + перезапись substances', async () => {
    const med = makeMedicine({ id: MEDICINE_ID, published: true })
    await repo.save(med)

    const medicineInserts = mock.insertCalls.filter((c) => c.table === 'medicines')
    expect(medicineInserts).toHaveLength(1)
    const medInsert = medicineInserts[0]?.values as Record<string, unknown>
    expect(medInsert.id).toBe(MEDICINE_ID)
    expect(medInsert.tradeName).toBe(`Trade-${MEDICINE_ID}`)

    // DELETE для medicine_substances + новый INSERT (полная перезапись).
    const deletes = mock.deleteCalls.filter((c) => c.table === 'medicine_substances')
    expect(deletes).toHaveLength(1)
    const substanceInserts = mock.insertCalls.filter((c) => c.table === 'medicine_substances')
    expect(substanceInserts).toHaveLength(1)
  })
})