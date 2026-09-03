/**
 * Drizzle-реализация `PharmacyInventoryRepository` (EP-05, DTJ-154).
 *
 * `upsertMany` — set-based `INSERT ... ON CONFLICT (pharmacy_id, medicine_id,
 * COALESCE(batch_number, ''), expires_at) DO UPDATE SET price=excluded.price,
 * quantity=excluded.quantity, updated_at=now()` (FEFO-инвариант) — раскрытый
 * SQL (`db.execute(sql\`...\`)`), не типизированный `.onConflictDoUpdate()`
 * (см. «ИСПРАВЛЕНО» в теле метода: Drizzle не поддерживает expression-таргет).
 *
 * `findOrCreateManyByMedicineIds` — ОДИН `SELECT ... WHERE pharmacy_id=$1
 * AND medicine_id = ANY($2)` (SRS-INV-052 п.4), для отсутствующих —
 * локальный `PharmacyInventory.create` (aggregate без лотов).
 *
 * `saveMany` — `INSERT ... ON CONFLICT DO UPDATE` (не голый `UPDATE` —
 * см. «ИСПРАВЛЕНО» в `upsertLot`: агрегат для НОВОГО медикамента этой
 * аптеки не имеет строки в БД, голый `UPDATE` матчил бы 0 строк и молча
 * терял бы данные) для каждого лота. Неэффективно для большого батча —
 * в R2 заменить на пакетный `INSERT ... VALUES (...), (...) ON CONFLICT`.
 *
 * DI: `@Inject(DRIZZLE_DB)` явный (esbuild/vitest не эмитит
 * `design:paramtypes`, DTJ-001, тот же приём, что в
 * `DrizzleFullSyncCompletionAdapter`/`postgres-pharmacy-map.adapter.ts`) —
 * без него, до волны 5, класс не был подключён как провайдер DI вообще
 * (`inventory.module.ts` продолжал биндить `PHARMACY_INVENTORY_REPOSITORY`
 * на InMemory), поэтому написанный код никогда не резолвился Nest'ом.
 *
 * `findOrCreateManyByMedicineIds`/`saveMany` принимают ОПЦИОНАЛЬНЫЙ `tx`
 * (волна 6, self-deadlock пула соединений, тот же дефект, что чинили в
 * checkout DTJ-231/233) — используют его через `resolveDrizzleClient`, чтобы
 * персистенция остатков была частью ТОЙ ЖЕ транзакции, что и
 * `IngestInventoryBatchWithMatchingUseCase.execute` (см. её JSDoc). `upsertMany`
 * (легаси-путь) `tx` не принимает — не вызывается ни одним `uow.run`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { PharmacyInventory } from '@/modules/inventory/domain/pharmacy-inventory.entity.js'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
  type UpsertResult,
} from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import type { InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'
import type { UnitOfWorkTx } from '@/modules/auth/index.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

/** Строка `pharmacy_inventory` (одна запись = один лот, R1). */
interface PharmacyInventoryRow {
  id: string
  pharmacyId: string
  medicineId: string
  batchNumber: string | null
  price: number
  quantity: number
  expiresAt: string
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class DrizzlePharmacyInventoryRepository implements PharmacyInventoryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async upsertMany(input: {
    pharmacyId: string
    rows: readonly InventoryBatchUpsertRow[]
  }): Promise<UpsertResult> {
    if (input.rows.length === 0) {
      return { acceptedCount: 0, updatedCount: 0 }
    }
    // ИСПРАВЛЕНО — волна 5, блок C (найдено интеграционным тестом против
    // реального Postgres, `drizzle-pharmacy-inventory.repository.integration.spec.ts`).
    // Прежняя версия использовала типизированный `.onConflictDoUpdate({ target:
    // [колонки...] })` — Drizzle транслирует это в ON CONFLICT ПО ПРОСТОМУ
    // списку колонок. Реальный уникальный индекс `ux_pharmacy_inventory_fefo`
    // (миграция `0012_inventory_foundation.sql`) — EXPRESSION-индекс:
    // `(pharmacy_id, medicine_id, COALESCE(batch_number, ''), expires_at)`.
    // Postgres требует ТОЧНОГО совпадения target-выражения с индексом; список
    // голых колонок (без `COALESCE`) не матчится НИ С ОДНОЙ строкой батча
    // (включая `batch_number IS NOT NULL`) — `INSERT` падал на КАЖДОМ вызове
    // с `42P10 there is no unique or exclusion constraint matching the ON
    // CONFLICT specification`. До этой правки метод не мог сработать ни разу
    // против реального Postgres (только против фейкового `DrizzleLike` в
    // юнит-тестах, которых для этого класса не было — см. отчёт сдачи).
    // `ON CONFLICT ON CONSTRAINT` не годится — `ux_pharmacy_inventory_fefo`
    // создан как `CREATE UNIQUE INDEX`, не как именованный table constraint
    // (`pg_constraint` его не перечисляет), поэтому только раскрытый SQL
    // с ТЕМ ЖЕ выражением `COALESCE(batch_number, '')` в target.
    const valuesSql = sql.join(
      input.rows.map(
        (row) =>
          sql`(${input.pharmacyId}, ${row.getMedicineId()}, ${row.getPrice()}, ${row.getQuantity()}, ${row.getExpiresAt()}, ${row.getBatchNumber() ?? null})`,
      ),
      sql`, `,
    )
    await this.db.execute(sql`
      INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
      VALUES ${valuesSql}
      ON CONFLICT (pharmacy_id, medicine_id, COALESCE(batch_number, ''), expires_at)
      DO UPDATE SET price = excluded.price, quantity = excluded.quantity, updated_at = now()
    `)
    // acceptedCount/updatedCount требуют RETURNING + сравнения.
    // В R1 возвращаем верхнюю границу: всё как «updated» (upsert всегда
    // меняет запись или вставляет). В R2 добавить SELECT до INSERT.
    return { acceptedCount: input.rows.length, updatedCount: 0 }
  }

  async findOrCreateManyByMedicineIds(input: {
    pharmacyId: string
    medicineIds: readonly string[]
  }, tx?: UnitOfWorkTx): Promise<ReadonlyMap<string, PharmacyInventory>> {
    if (input.medicineIds.length === 0) return new Map()
    const rows = await this.selectExistingRows(input.pharmacyId, input.medicineIds, tx)
    const result = new Map<string, PharmacyInventory>()
    for (const row of rows) {
      result.set(row.medicineId, this.restoreRow(row))
    }
    for (const medicineId of input.medicineIds) {
      if (result.has(medicineId)) continue
      result.set(medicineId, this.createEmpty(input.pharmacyId, medicineId))
    }
    return result
  }

  /** Строки БД для существующих `pharmacy_inventory` (ОДИН запрос, SRS-INV-052 п.4). */
  private async selectExistingRows(
    pharmacyId: string,
    medicineIds: readonly string[],
    tx?: UnitOfWorkTx,
  ): Promise<readonly PharmacyInventoryRow[]> {
    const client = resolveDrizzleClient(this.db, tx)
    return client
      .select({
        id: pharmacyInventory.id,
        pharmacyId: pharmacyInventory.pharmacyId,
        medicineId: pharmacyInventory.medicineId,
        batchNumber: pharmacyInventory.batchNumber,
        price: pharmacyInventory.price,
        quantity: pharmacyInventory.quantity,
        expiresAt: pharmacyInventory.expiresAt,
        createdAt: pharmacyInventory.createdAt,
        updatedAt: pharmacyInventory.updatedAt,
      })
      .from(pharmacyInventory)
      .where(
        and(
          eq(pharmacyInventory.pharmacyId, pharmacyId),
          inArray(pharmacyInventory.medicineId, medicineIds as string[]),
        ),
      )
  }

  /** Восстановление агрегата из строки БД (одна запись = один лот). */
  private restoreRow(row: PharmacyInventoryRow): PharmacyInventory {
    const aggregate = PharmacyInventory.restore({
      id: row.id,
      pharmacyId: row.pharmacyId,
      medicineId: row.medicineId,
      lots: [
        {
          batchNumber: row.batchNumber,
          priceDiram: BigInt(row.price),
          quantity: row.quantity,
          expiryDateIso: row.expiresAt,
          lastSyncedAt: row.updatedAt,
        },
      ],
    })
    if (!aggregate.ok) {
      throw new Error(`failed to restore PharmacyInventory: ${aggregate.error.message}`)
    }
    return aggregate.value
  }

  /** Пустой агрегат (без лотов) для medicineId без существующей записи. */
  private createEmpty(pharmacyId: string, medicineId: string): PharmacyInventory {
    const created = PharmacyInventory.create({
      id: `${pharmacyId}::${medicineId}`,
      pharmacyId,
      medicineId,
    })
    if (!created.ok) {
      throw new Error(`failed to create PharmacyInventory: ${created.error.message}`)
    }
    return created.value
  }

  async saveMany(aggregates: readonly PharmacyInventory[], tx?: UnitOfWorkTx): Promise<void> {
    // R2 (не сделано здесь): batch-UPSERT одним `INSERT ... VALUES (...), (...) ON
    // CONFLICT ...` для всех лотов сразу — сейчас один upsert-запрос на лот.
    // Лоты независимы (разные pharmacyId/medicineId/batchNumber/expiresAt) —
    // выполняются параллельно, а не последовательно в цикле с await.
    const updates = aggregates.flatMap((aggregate) =>
      (
        aggregate.getLots() as readonly {
          batchNumber: string | null
          price: { diram: bigint }
          quantity: number
          expiryDate: { isoDate: string }
          lastSyncedAt: Date
        }[]
      ).map((lot) => ({ aggregate, lot })),
    )
    await Promise.all(updates.map(({ aggregate, lot }) => this.upsertLot(aggregate, lot, tx)))
  }

  /**
   * `INSERT ... ON CONFLICT (...) DO UPDATE` для одного лота агрегата — НЕ
   * голый `UPDATE`.
   *
   * **ИСПРАВЛЕНО — волна 5, блок C (найдено живой приёмкой `node dist/main.js`
   * против реального Postgres, боевой маршрут `POST /inventory/batch-update`,
   * см. отчёт сдачи).** Прежняя версия делала ГОЛЫЙ `UPDATE ... WHERE
   * pharmacyId=... AND medicineId=... AND batchNumber=...` — для агрегата,
   * созданного `findOrCreateManyByMedicineIds` как «пустой» (медикамент
   * впервые синхронизируется этой аптекой — САМЫЙ ЧАСТЫЙ случай, не
   * крайний), `applyDelta` добавляет НОВЫЙ лот в память, но соответствующей
   * строки в `pharmacy_inventory` ЕЩЁ НЕТ — `UPDATE` матчит 0 строк и
   * МОЛЧА ничего не делает (Postgres не бросает ошибку на `UPDATE`
   * с нулевым числом задетых строк). Результат: `IngestInventoryBatchWithMatchingUseCase`
   * отчитывается `completed_full_success` (0 ошибок), но остаток НИКОГДА
   * не появляется в `pharmacy_inventory` — accepted и rejected оба равны 0,
   * потому что `applyRowDelta` возвращает `true` (лот добавлен В ПАМЯТИ
   * агрегата), а персистентность теряется НИЖЕ, в `saveMany`. Юнит-тест
   * `ingest-inventory-batch-with-matching.use-case.spec.ts` этого не ловит —
   * использует InMemory-репозиторий, где `saveMany`-эквивалент честно
   * заменяет всю Map целиком. Собственный интеграционный тест этого файла
   * (`drizzle-pharmacy-inventory.repository.integration.spec.ts`) тоже не
   * ловил — сценарий там ВСЕГДА предварительно вызывал `upsertMany` для
   * ТОГО ЖЕ `(medicineId, batchNumber, expiresAt)` ДО `saveMany`, то есть
   * строка уже существовала. Первый реальный «медикамент синхронизируется
   * впервые» прогон (боевой POST) обнажил дефект.
   */
  private async upsertLot(
    aggregate: PharmacyInventory,
    lot: {
      batchNumber: string | null
      price: { diram: bigint }
      quantity: number
      expiryDate: { isoDate: string }
      lastSyncedAt: Date
    },
    tx?: UnitOfWorkTx,
  ): Promise<void> {
    // Тот же приём, что `upsertMany` — expression-индекс `ux_pharmacy_inventory_fefo`
    // (`COALESCE(batch_number, '')`) недоступен через типизированный
    // `.onConflictDoUpdate({ target: [...] })` Drizzle.
    const client = resolveDrizzleClient(this.db, tx)
    await client.execute(sql`
      INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at, batch_number, updated_at)
      VALUES (
        ${aggregate.pharmacyId}, ${aggregate.medicineId},
        ${Number(lot.price.diram)}, ${lot.quantity}, ${lot.expiryDate.isoDate}, ${lot.batchNumber},
        ${lot.lastSyncedAt}
      )
      ON CONFLICT (pharmacy_id, medicine_id, COALESCE(batch_number, ''), expires_at)
      DO UPDATE SET price = excluded.price, quantity = excluded.quantity, updated_at = excluded.updated_at
    `)
  }
}

export const PHARMACY_INVENTORY_DRIZZLE_PROVIDER = {
  provide: PHARMACY_INVENTORY_REPOSITORY,
  useClass: DrizzlePharmacyInventoryRepository,
} as const
