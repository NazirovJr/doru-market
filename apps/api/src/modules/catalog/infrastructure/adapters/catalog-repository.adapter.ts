/**
 * Drizzle-реализация `CatalogRepository` (DTJ-092, EP-04, R1).
 *
 * Это ЕДИНСТВЕННАЯ продакшен-реализация унифицированного порта. Она делает:
 *
 *   1. `findMedicineById` / `findMedicinesByIds` — ОДИН SELECT с LEFT JOIN
 *      на `medicine_substances`, агрегация в JS (без `array_agg` — проще
 *      мапить, см. SRS-CAT-005). Без N+1: инвариант проверяется в
 *      integration-тесте `catalog-repository.adapter.integration.spec.ts`.
 *
 *   2. `findCategoryTree` — один SELECT всех активных категорий + построение
 *      дерева в памяти через `CategoryTreeService.buildTree` (≤200 узлов
 *      ожидаемо, SRS-CAT-004).
 *
 *   3. `findSubstancesByMedicineIds` — ОДИН SELECT с `INNER JOIN medicine_substances ⋈
 *      substances` (за названием вещества, `innName` — правка DTJ-234, было `''`
 *      хардкодом), группировка результатов в JS по `medicineId`.
 *
 *   4. `save` — `INSERT ... ON CONFLICT (id) DO UPDATE` для `medicines` +
 *      DELETE/INSERT для `medicine_substances` (композитный PK не имеет
 *      смысла для UPSERT; множество веществ — заменяем полностью).
 *
 * **Фильтр видимости (`control_category`, `is_published`)** НЕ применяется
 * на уровне этого репозитория — это ответственность use case/presentation,
 * SRS-CAT-006: репозиторий возвращает запись как есть, чтобы super_admin-
 * эндпоинты модерации могли читать скрытые записи через тот же репозиторий.
 *
 * **Drizzle-инстанс** — общий `DrizzleDb` из `infrastructure/database/drizzle.provider.ts`
 * (DTJ-051 follow-up). Не используем транзакции в этом тикете — `save` для
 * R1 атомарен на уровне одного `Medicine` (medicines + его substances), но
 * пишется НЕ в транзакции; полная транзакционная семантика — задача
 * `UnitOfWorkPort`, который вводится в EP-19.
 *
 * **Тестовая среда.** Адаптер компилируется и резолвится в DI-графе
 * независимо от наличия БД (конструктор не открывает соединение). Реальное
 * соединение устанавливает `DrizzleDb` lazy при первом запросе. Это позволяет
 * использовать адаптер в интеграционных тестах с testcontainers Postgres и
 * в unit-тестах с in-memory моками `DrizzleLike`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq, inArray } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { categories } from '@/db/schema/categories.js'
import { medicines } from '@/db/schema/medicines.js'
import { medicineSubstances } from '@/db/schema/medicine-substances.js'
import { substances } from '@/db/schema/substances.js'
import { CategoryTreeService } from '@/modules/catalog/domain/services/category-tree.service.js'
import { Medicine } from '@/modules/catalog/domain/medicine.entity.js'
import type { CategoryNode, MedicineRecord, SubstanceRef } from '@/modules/catalog/domain/medicine.types.js'
import { type CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import { toDomain, toRecord, type SubstanceNameRowLike, type SubstanceRowLike } from '../mappers/medicine.mapper.js'

@Injectable()
export class CatalogRepositoryAdapter implements CatalogRepository {
  private readonly treeBuilder: CategoryTreeService

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {
    this.treeBuilder = new CategoryTreeService()
  }

  async findMedicineById(id: string): Promise<MedicineRecord | null> {
    const rows = await this.db
      .select()
      .from(medicines)
      .where(eq(medicines.id, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const joins = await this.loadSubstanceJoins([id])
    const entity = toDomain(row, joins.get(id) ?? [])
    return toRecord(entity, row.barcode)
  }

  async findMedicinesByIds(ids: readonly string[]): Promise<MedicineRecord[]> {
    if (ids.length === 0) return []
    const uniqueIds = uniqueStringArray(ids)
    const medicineRows = await this.db
      .select()
      .from(medicines)
      .where(inArray(medicines.id, uniqueIds))
    if (medicineRows.length === 0) return []
    const joins = await this.loadSubstanceJoins(uniqueIds)
    const out: MedicineRecord[] = []
    for (const row of medicineRows) {
      const entity = toDomain(row, joins.get(row.id) ?? [])
      out.push(toRecord(entity, row.barcode))
    }
    return out
  }

  async findCategoryTree(): Promise<readonly CategoryNode[]> {
    // Один SELECT всех активных категорий (≤200 узлов ожидаемо, SRS-CAT-004).
    // Сортировка по `sort_order` нужна, чтобы порядок детей был стабильным
    // и не зависел от порядка строк в таблице.
    const rows = await this.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        slug: categories.slug,
        nameTj: categories.nameTj,
        nameRu: categories.nameRu,
        nameEn: categories.nameEn,
        commissionCategory: categories.commissionCategory,
        sortOrder: categories.sortOrder,
        isActive: categories.isActive,
      })
      .from(categories)
      .where(eq(categories.isActive, 1))
      .orderBy(categories.sortOrder)
    const flat = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      nameTj: row.nameTj,
      nameRu: row.nameRu,
      nameEn: row.nameEn,
      commissionCategory: row.commissionCategory as 'rx' | 'otc' | 'parapharma',
      sortOrder: row.sortOrder,
      isActive: row.isActive === 1,
    }))
    return this.treeBuilder.buildTree(flat)
  }

  async findSubstancesByMedicineIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SubstanceRef[]>> {
    if (ids.length === 0) return new Map()
    const uniqueIds = uniqueStringArray(ids)
    const joins = await this.loadSubstanceNameJoins(uniqueIds)
    const out = new Map<string, readonly SubstanceRef[]>()
    for (const id of uniqueIds) {
      const list = joins.get(id) ?? []
      out.set(
        id,
        list.map(
          (row): SubstanceRef => ({
            substanceId: row.substanceId,
            innName: row.innName,
            strengthValue: toNumberLike(row.strengthValue),
            strengthUnit: row.strengthUnit,
          }),
        ),
      )
    }
    return out
  }

  async save(medicine: Medicine): Promise<void> {
    // Штрихкод для записи: `getBarcode()` возвращает доменный VO или `null`.
    // `Barcode` не переопределяет `toString()` — сериализуем через `getRawValue()`
    // явно (см. DTJ-090 JSDoc на `Barcode`).
    const barcodeVo = medicine.getBarcode()
    const barcodeForRecord: string | null = barcodeVo === null ? null : barcodeVo.getRawValue()
    const record = toRecord(medicine, barcodeForRecord)

    await this.upsertMedicineRow(record)
    await this.replaceSubstances(record.id, medicine)
  }

  /** INSERT ... ON CONFLICT (id) DO UPDATE — атомарный upsert `medicines`. */
  private async upsertMedicineRow(record: MedicineRecord): Promise<void> {
    const columns = {
      tradeName: record.tradeName,
      innName: record.innName,
      barcode: record.barcode,
      isGloballyIdentifiableByBarcode: record.isGloballyIdentifiableByBarcode,
      categoryId: record.categoryId,
      dosageForm: record.dosageForm,
      dosageFormClass: record.dosageFormClass,
      dosageStrength: record.dosageStrength,
      manufacturerCountry: record.manufacturerCountry,
      manufacturerName: record.manufacturerName,
      isPrescriptionRequired: record.isPrescriptionRequired,
      controlCategory: record.controlCategory,
      isPublished: record.isPublished,
      requiresColdChain: record.requiresColdChain,
      imageUrl: record.imageUrl,
      descriptionTj: record.descriptionTj,
      descriptionRu: record.descriptionRu,
    }
    await this.db
      .insert(medicines)
      .values({
        id: record.id,
        ...columns,
        // `dosageValue` и `dosageUnit` НЕ сохраняем через доменный путь —
        // они заполняются сидом/импортом и не управляются `Medicine`. Если
        // use case DTJ-099 захочет их писать — расширим сигнатуру `save`.
        dosageValue: null,
        dosageUnit: null,
        storageTemperature: null,
        updatedAt: new Date(),
      } as typeof medicines.$inferInsert)
      .onConflictDoUpdate({
        target: medicines.id,
        set: { ...columns, updatedAt: new Date() },
      })
  }

  /**
   * Множество веществ — перезаписываем целиком: DELETE существующих + INSERT
   * новых. Это простая и корректная семантика для R1; оптимизация через
   * MERGE / bulk upsert — задача R2.
   */
  private async replaceSubstances(medicineId: string, medicine: Medicine): Promise<void> {
    const substanceRecords = medicine.getSubstances().map((s) => ({
      substanceId: s.substanceId,
      strengthValue: String(s.strengthValue),
      strengthUnit: s.strengthUnit,
    }))

    await this.db.delete(medicineSubstances).where(eq(medicineSubstances.medicineId, medicineId))
    if (substanceRecords.length > 0) {
      await this.db.insert(medicineSubstances).values(
        substanceRecords.map((s) => ({
          medicineId,
          substanceId: s.substanceId,
          strengthValue: s.strengthValue,
          strengthUnit: s.strengthUnit,
        })),
      )
    }
  }

  /** Один SELECT с `medicine_substances` для списка препаратов. */
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

  /**
   * Дефект приёмки DTJ-234 (найден живым интеграционным прогоном исполнителем EP-09,
   * см. отчёт сдачи): `findSubstancesByMedicineIds` возвращал `innName: ''` — JOIN был
   * ТОЛЬКО на `medicine_substances`, без JOIN на `substances` за самим названием.
   * `CatalogFacade.getSubstances()` поэтому никогда не отдавал реальное название вещества.
   *
   * Отдельный метод, не расширение `loadSubstanceJoins` — тот путь обслуживает
   * `findMedicineById`/`findMedicinesByIds` (реконструкция `Medicine`, которой имя вещества
   * не нужно, см. `MedicineSubstanceRecord`), лишний JOIN туда добавлять незачем.
   * `INNER JOIN` безопасен: `medicine_substances.substance_id` несёт FK на `substances(id)`
   * (`11-database-schema.md`), потерять валидную строку он не может.
   */
  private async loadSubstanceNameJoins(
    medicineIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SubstanceNameRowLike[]>> {
    if (medicineIds.length === 0) return new Map()
    const rows = await this.db
      .select({
        medicineId: medicineSubstances.medicineId,
        substanceId: medicineSubstances.substanceId,
        innName: substances.innName,
        strengthValue: medicineSubstances.strengthValue,
        strengthUnit: medicineSubstances.strengthUnit,
      })
      .from(medicineSubstances)
      .innerJoin(substances, eq(medicineSubstances.substanceId, substances.id))
      .where(inArray(medicineSubstances.medicineId, medicineIds as string[]))

    const out = new Map<string, SubstanceNameRowLike[]>()
    for (const row of rows) {
      const list = out.get(row.medicineId) ?? []
      list.push({
        substanceId: row.substanceId,
        innName: row.innName,
        strengthValue: row.strengthValue,
        strengthUnit: row.strengthUnit,
      })
      out.set(row.medicineId, list)
    }
    return out
  }
}

/** Идемпотентная уникализация массива строк (порядок сохраняется). */
function uniqueStringArray(input: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of input) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** Безопасное преобразование `number | string` (Drizzle NUMERIC) → `number`. */
function toNumberLike(raw: number | string): number {
  if (typeof raw === 'number') return raw
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 0
}