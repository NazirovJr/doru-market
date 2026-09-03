/**
 * Drizzle-реализация `MedicineReadRepository` (DTJ-092/094 follow-up, Волна 5 блок B).
 *
 * DEFECT-FIX (см. `reports/CTO-DECISION-WAVE5.md` §3, блок B): порт был подключён к
 * `InMemoryMedicineReadRepository` (`initial: readonly Medicine[] = []`) без единого способа
 * заполнить её в проде — `GET /api/v1/medicines` (список) читал ПУСТОЙ `Map` независимо от
 * содержимого Postgres. Этот адаптер — единственная продакшен-реализация порта, читает
 * `medicines`/`medicine_substances` напрямую (тот же приём, что `CatalogRepositoryAdapter`,
 * DTJ-092: один SELECT medicines + один батч-SELECT substances, без N+1).
 *
 * **Фильтр видимости — на уровне SQL для списков, в домене для `findById`.** Контракт ЭТОГО
 * порта (см. `application/ports/medicine-read.repository.port.ts`) требует: `findById`
 * ВСЕГДА `null` для `psychotropic`/`narcotic` (SRS-CAT-006), `listByCategoryId`/`listPublished`
 * — только `isPublished = true` и без запрещённых категорий.
 *   - `findById` проверяет ПОСЛЕ маппинга в домен (`medicine.getControlCategory()`,
 *     `CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(...)`) — тот же приём, что
 *     `InMemoryMedicineReadRepository.findById` (единый источник истины про
 *     запрещённые категории, не дублируем строковые литералы).
 *   - `listByCategoryId`/`listPublished` фильтруют В `WHERE` (не в JS после SELECT) —
 *     иначе `LIMIT`/`OFFSET` пагинации считали бы с учётом строк, которые всё равно
 *     будут вырезаны, и клиент получал бы страницы короче объявленного `limit`. SQL не
 *     может сравнить с `ReadonlySet<ControlCategory>` (enum) напрямую — литералы
 *     `'psychotropic'/'narcotic'` в `NOT IN (...)` дублируют значения `ControlCategory`
 *     (тот же приём, что уже принят `postgres-pharmacy-map.adapter.ts`,
 *     `offerLateralFragment`, см. её JSDoc).
 *
 * **Сортировка.** Спецификация (`docs/spec/20-module-catalog-search.md`, тикеты DTJ-092/094)
 * не фиксирует порядок для простого списка (в отличие от полнотекстового поиска, у которого
 * есть `finalScore DESC`/`sort=price_asc`). `ORDER BY trade_name, id` — ASSUMPTION: детерминизм
 * важнее конкретного порядка (без него `LIMIT`/`OFFSET` на одинаковых значениях может отдавать
 * несовпадающие страницы между запросами, а UI ожидает стабильный листинг).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { medicines } from '@/db/schema/medicines.js'
import { medicineSubstances } from '@/db/schema/medicine-substances.js'
import { CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE } from '@/modules/catalog/domain/medicine.enums.js'
import { type Medicine } from '@/modules/catalog/domain/medicine.entity.js'
import type {
  ListMedicinesParams,
  MedicineReadRepository,
} from '@/modules/catalog/application/ports/medicine-read.repository.port.js'
import { toDomain, type SubstanceRowLike } from '../mappers/medicine.mapper.js'

@Injectable()
export class PostgresMedicineReadRepository implements MedicineReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<Medicine | null> {
    const rows = await this.db.select().from(medicines).where(eq(medicines.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    const joins = await this.loadSubstanceJoins([id])
    const medicine = toDomain(row, joins.get(id) ?? [])
    if (CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(medicine.getControlCategory())) {
      // SRS-CAT-006: существование запрещённой к обороту записи не подтверждается постороннему.
      return null
    }
    return medicine
  }

  async listByCategoryId(categoryId: number, params: ListMedicinesParams): Promise<readonly Medicine[]> {
    return this.listWhere(and(eq(medicines.categoryId, categoryId), this.visibilityFragment()), params)
  }

  async listPublished(params: ListMedicinesParams): Promise<readonly Medicine[]> {
    return this.listWhere(this.visibilityFragment(), params)
  }

  /**
   * `isPublished = true` И без `psychotropic`/`narcotic` — инвариант `Medicine.canOrderRemotely()`.
   * Литералы см. JSDoc файла: SQL не умеет сравнивать с доменным `ReadonlySet<ControlCategory>`.
   */
  private visibilityFragment(): SQL {
    return sql`${medicines.isPublished} = true AND ${medicines.controlCategory} NOT IN ('psychotropic', 'narcotic')`
  }

  private async listWhere(where: SQL | undefined, params: ListMedicinesParams): Promise<readonly Medicine[]> {
    const rows = await this.db
      .select()
      .from(medicines)
      .where(where)
      .orderBy(medicines.tradeName, medicines.id)
      .limit(params.limit)
      .offset(params.offset)
    if (rows.length === 0) {
      return []
    }
    const ids = rows.map((row) => row.id)
    const joins = await this.loadSubstanceJoins(ids)
    return rows.map((row) => toDomain(row, joins.get(row.id) ?? []))
  }

  /**
   * Один SELECT с `medicine_substances` для батча medicine id (без N+1) — тот же приём,
   * что `CatalogRepositoryAdapter.loadSubstanceJoins` (DTJ-092). Не переиспользуется напрямую:
   * там метод `private`, а вынесение в общий модуль — за рамками блока B (Волна 5, только
   * `MEDICINE_READ_REPOSITORY`/`CATEGORIES_READ_REPOSITORY`), см. отчёт сдачи.
   */
  private async loadSubstanceJoins(
    medicineIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SubstanceRowLike[]>> {
    if (medicineIds.length === 0) return new Map()
    const rows = await this.db
      .select({
        medicineId: medicineSubstances.medicineId,
        substanceId: medicineSubstances.substanceId,
        strengthValue: medicineSubstances.strengthValue,
        strengthUnit: medicineSubstances.strengthUnit,
      })
      .from(medicineSubstances)
      .where(inArray(medicineSubstances.medicineId, medicineIds as string[]))

    const out = new Map<string, SubstanceRowLike[]>()
    for (const row of rows) {
      const list = out.get(row.medicineId) ?? []
      list.push({
        substanceId: row.substanceId,
        strengthValue: row.strengthValue,
        strengthUnit: row.strengthUnit,
      })
      out.set(row.medicineId, list)
    }
    return out
  }
}
