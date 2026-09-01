/**
 * Тесты для `runSeedCatalog` (DTJ-098, EP-04). Проверяют:
 *
 * 1. **≥300 medicines** — критерий приёмки D-13.
 * 2. **Идемпотентность** — повторный запуск не создаёт дублей (критерий приёмки DTJ-098).
 * 3. **≥5 аналоговых групп** — через логический ключ `(trade_name, dosage_strength,
 *    manufacturer_name)` уникальность сохраняется, но аналоговая группа
 *    обнаруживается по множеству `substances[]` (см. тикет).
 * 4. **Никаких narcotic в seed** — инвариант SRS-DOM-014.
 *
 * Использует in-memory мок `SeedCatalogPort`, чтобы не зависеть от реальной БД
 * (это unit-тест, не интеграционный). Интеграционный тест с testcontainers
 * остаётся отдельным тикетом (см. README §EP-04 и тест-план DTJ-098).
 *
 * Защита от двойного запуска main: при импорте из vitest
 * `process.env.DORUTJ_SEED_SKIP_MAIN = '1'` (см. `seed-catalog.run.ts:main()`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runSeedCatalog, type SeedCatalogPort } from './seed-catalog.run.js'
import type { CategoryRow, MedicineRow, SubstanceRow } from '@/db/schema/index.js'
import type { DosageUnit } from '@dorutj/domain-kernel'

beforeAll(() => {
  process.env.DORUTJ_SEED_SKIP_MAIN = '1'
})

afterAll(() => {
  delete process.env.DORUTJ_SEED_SKIP_MAIN
})

/** Состояние in-memory мока порта (для проверки идемпотентности). */
interface MockState {
  categories: Map<number, Omit<CategoryRow, 'id'> & { id: number }>
  substances: Map<string, Omit<SubstanceRow, 'createdAt'>>
  medicines: Map<string, Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'>>
  medicineSubstances: {
    medicineId: string
    substanceId: string
    strengthValue: number
    strengthUnit: DosageUnit
  }[]
  nextCategoryId: number
}

function createMockPort(): { port: SeedCatalogPort; state: MockState } {
  const state: MockState = {
    categories: new Map(),
    substances: new Map(),
    medicines: new Map(),
    medicineSubstances: [],
    nextCategoryId: 1,
  }

  const port: SeedCatalogPort = {
    insertCategory(row): Promise<number> {
      // Идемпотентность по slug — ищем существующую
      for (const cat of state.categories.values()) {
        if (cat.slug === row.slug) return Promise.resolve(cat.id)
      }
      const id = state.nextCategoryId++
      state.categories.set(id, { ...row, id })
      return Promise.resolve(id)
    },
    insertSubstance(row): Promise<void> {
      if (state.substances.has(row.id)) return Promise.resolve()
      state.substances.set(row.id, row)
      return Promise.resolve()
    },
    insertMedicine(row, medSubstances): Promise<void> {
      // Идемпотентность по логическому ключу (как в Drizzle-порте)
      for (const med of state.medicines.values()) {
        if (
          med.tradeName === row.tradeName &&
          med.dosageStrength === row.dosageStrength &&
          med.manufacturerName === row.manufacturerName
        ) {
          return Promise.resolve()
        }
      }
      state.medicines.set(row.id, row)
      for (const s of medSubstances) {
        state.medicineSubstances.push({
          medicineId: row.id,
          substanceId: s.substanceId,
          strengthValue: s.strengthValue,
          strengthUnit: s.strengthUnit,
        })
      }
      return Promise.resolve()
    },
    countMedicines(): Promise<number> {
      return Promise.resolve(state.medicines.size)
    },
  }

  return { port, state }
}

describe('runSeedCatalog (DTJ-098, EP-04)', () => {
  it('вставляет ≥300 позиций medicines (D-13)', async () => {
    const { port, state } = createMockPort()
    const result = await runSeedCatalog(port)
    expect(result.medicinesInserted).toBeGreaterThanOrEqual(300)
    expect(state.medicines.size).toBe(result.medicinesInserted)
  }, 30_000)

  it('вставляет ≥80 substances и ≥15 categories', async () => {
    const { port, state } = createMockPort()
    await runSeedCatalog(port)
    expect(state.substances.size).toBeGreaterThanOrEqual(80)
    expect(state.categories.size).toBeGreaterThanOrEqual(15)
  }, 30_000)

  it('идемпотентен: повторный запуск не увеличивает счётчик', async () => {
    const { port, state } = createMockPort()
    const first = await runSeedCatalog(port)
    const second = await runSeedCatalog(port)
    expect(second.medicinesInserted).toBe(0)
    expect(state.medicines.size).toBe(first.medicinesInserted)
  }, 30_000)

  it('не содержит позиций с controlCategory="narcotic" (SRS-DOM-014)', async () => {
    const { port, state } = createMockPort()
    await runSeedCatalog(port)
    const narcoticCount = [...state.medicines.values()].filter(
      (m) => m.controlCategory === 'narcotic',
    ).length
    expect(narcoticCount).toBe(0)
  }, 30_000)

  it('не содержит позиций с controlCategory="psychotropic" (SRS-DOM-014)', async () => {
    const { port, state } = createMockPort()
    await runSeedCatalog(port)
    const psychotropicCount = [...state.medicines.values()].filter(
      (m) => m.controlCategory === 'psychotropic',
    ).length
    expect(psychotropicCount).toBe(0)
  }, 30_000)

  it('формирует ≥5 аналоговых групп (≥2 medicines с одинаковым набором substances+dosageForm+dosageStrength)', async () => {
    const { port, state } = createMockPort()
    await runSeedCatalog(port)
    // Группируем medicines по ключу: dosageFormClass + dosageStrength + отсортированный список substanceId
    const groups = new Map<string, number>()
    for (const med of state.medicines.values()) {
      const mySubstances = state.medicineSubstances
        .filter((ms) => ms.medicineId === med.id)
        .map((ms) => `${ms.substanceId}:${String(ms.strengthValue)}:${ms.strengthUnit}`)
        .sort()
        .join('|')
      const key = `${med.dosageFormClass}::${med.dosageStrength}::${mySubstances}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    const analogGroupCount = [...groups.values()].filter((n) => n >= 2).length
    expect(analogGroupCount).toBeGreaterThanOrEqual(5)
  }, 30_000)

  it('содержит комбинированные препараты (≥30 medicines с 2+ substances)', async () => {
    const { port, state } = createMockPort()
    await runSeedCatalog(port)
    const counts = new Map<string, number>()
    for (const ms of state.medicineSubstances) {
      counts.set(ms.medicineId, (counts.get(ms.medicineId) ?? 0) + 1)
    }
    const combined = [...counts.values()].filter((n) => n >= 2).length
    expect(combined).toBeGreaterThanOrEqual(30)
  }, 30_000)
})