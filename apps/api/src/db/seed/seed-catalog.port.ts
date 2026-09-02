/**
 * Минимальный порт БД для seed-скрипта каталога.
 *
 * Этот файл существует для разрыва циркулярной зависимости (правило Ж3 +
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md`):
 *   - `seed-catalog.run.ts` объявляет логику сида и зависит от интерфейса.
 *   - `seed-catalog-drizzle-port.ts` реализует интерфейс и зависит от типа.
 *
 * Если интерфейс лежит в `seed-catalog.run.ts`, то обе стороны тянут друг друга —
 * `arch:check no-circular` падает. Вынос интерфейса в отдельный модуль
 * устраняет цикл: ни `run.ts`, ни `drizzle-port.ts` не импортируют друг друга,
 * оба импортируют только `seed-catalog.port.ts`.
 */
import type { DosageUnit } from '@dorutj/domain-kernel'
import type { CategoryRow, MedicineRow, SubstanceRow } from '@/db/schema/index.js'

export interface SeedCatalogPort {
  insertCategory(row: Omit<CategoryRow, 'id'>): Promise<number>
  insertSubstance(row: Omit<SubstanceRow, 'createdAt'>): Promise<void>
  insertMedicine(
    row: Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'>,
    substances: readonly { substanceId: string; strengthValue: number; strengthUnit: DosageUnit }[],
  ): Promise<void>
  countMedicines(): Promise<number>
}