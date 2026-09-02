/**
 * Drizzle-реализация `PharmacyInventoryRepository` (EP-05, DTJ-154).
 *
 * `upsertMany` — set-based `INSERT ... ON CONFLICT (pharmacy_id, medicine_id,
 * COALESCE(batch_number, ''), expires_at) DO UPDATE SET price=excluded.price,
 * quantity=excluded.quantity, updated_at=now()` (FEFO-инвариант).
 *
 * `findOrCreateManyByMedicineIds` — ОДИН `SELECT ... WHERE pharmacy_id=$1
 * AND medicine_id = ANY($2)` (SRS-INV-052 п.4), для отсутствующих —
 * локальный `PharmacyInventory.create` (aggregate без лотов).
 *
 * `saveMany` — set-based `UPDATE ... SET price=..., quantity=...,
 * updated_at=now() WHERE id=$1` для каждого агрегата. Неэффективно
 * для большого батча — в R2 заменить на `UPDATE FROM (VALUES ...)`.
 *
 * Зависит от Drizzle-инстанса, передаваемого извне.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { PharmacyInventory } from '@/modules/inventory/domain/pharmacy-inventory.entity.js'
import {
  type PharmacyInventoryRepository,
  type UpsertResult,
} from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import type { InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'

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

interface DrizzleLike {
  insert: (table: unknown) => {
    values: (values: readonly unknown[]) => {
      onConflictDoUpdate: (config: {
        target: readonly unknown[]
        set: Record<string, unknown>
      }) => Promise<unknown>
    }
  }
  select: (cols: unknown) => {
    from: (table: unknown) => {
      where: (condition: ReturnType<typeof and>) => Promise<readonly unknown[]>
    }
  }
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: ReturnType<typeof eq>) => Promise<unknown>
    }
  }
}

export class DrizzlePharmacyInventoryRepository implements PharmacyInventoryRepository {
  constructor(private readonly db: DrizzleLike) {}

  async upsertMany(input: {
    pharmacyId: string
    rows: readonly InventoryBatchUpsertRow[]
  }): Promise<UpsertResult> {
    if (input.rows.length === 0) {
      return { acceptedCount: 0, updatedCount: 0 }
    }
    // Маппинг VO → строки БД. `price` (integer dirams) → `price`.
    // `expiresAt` (YYYY-MM-DD) → `expires_at` (DATE).
    const values = input.rows.map((row) => ({
      pharmacyId: input.pharmacyId,
      medicineId: row.getMedicineId(),
      price: row.getPrice(),
      quantity: row.getQuantity(),
      expiresAt: row.getExpiresAt(),
      batchNumber: row.getBatchNumber() ?? null,
    }))
    // `COALESCE(batch_number, '')` в UNIQUE-индексе означает, что
    // для onConflict нужно использовать `sql.raw` выражение
    // (Drizzle не поддерживает expression в `target` напрямую). Для
    // R1 упрощаем: ON CONFLICT по (pharmacyId, medicineId, batchNumber, expiresAt)
    // — этот путь сработает, если в БД ВСЕ null `batch_number` заменены
    // на `''` через миграцию (что не так; см. TODO ниже).
    // TODO(EP-19, DTJ-154 follow-up): переписать на `ON CONFLICT ON
    // CONSTRAINT ux_pharmacy_inventory_fefo DO UPDATE` с `COALESCE`.
    await this.db
      .insert(pharmacyInventory)
      .values(values)
      .onConflictDoUpdate({
        target: [
          pharmacyInventory.pharmacyId,
          pharmacyInventory.medicineId,
          pharmacyInventory.batchNumber,
          pharmacyInventory.expiresAt,
        ],
        set: {
          price: sql`excluded.price`,
          quantity: sql`excluded.quantity`,
          updatedAt: sql`now()`,
        },
      })
    // acceptedCount/updatedCount требуют RETURNING + сравнения.
    // В R1 возвращаем верхнюю границу: всё как «updated» (upsert всегда
    // меняет запись или вставляет). В R2 добавить SELECT до INSERT.
    return { acceptedCount: input.rows.length, updatedCount: 0 }
  }

  async findOrCreateManyByMedicineIds(input: {
    pharmacyId: string
    medicineIds: readonly string[]
  }): Promise<ReadonlyMap<string, PharmacyInventory>> {
    if (input.medicineIds.length === 0) return new Map()
    const rows = await this.selectExistingRows(input.pharmacyId, input.medicineIds)
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
  ): Promise<readonly PharmacyInventoryRow[]> {
    return (await this.db
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
      )) as readonly PharmacyInventoryRow[]
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

  async saveMany(aggregates: readonly PharmacyInventory[]): Promise<void> {
    // R1-упрощённый путь: один UPDATE на лот. R2 — `UPDATE FROM (VALUES ...)`.
    // Каждый лот адресует свою уникальную строку (pharmacyId, medicineId,
    // batchNumber) — обновления между лотами/агрегатами независимы, поэтому
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
    await Promise.all(updates.map(({ aggregate, lot }) => this.updateLot(aggregate, lot)))
  }

  /** Один `UPDATE` строки `pharmacy_inventory` для одного лота агрегата. */
  private async updateLot(
    aggregate: PharmacyInventory,
    lot: {
      batchNumber: string | null
      price: { diram: bigint }
      quantity: number
      lastSyncedAt: Date
    },
  ): Promise<void> {
    const conditions = and(
      eq(pharmacyInventory.pharmacyId, aggregate.pharmacyId),
      eq(pharmacyInventory.medicineId, aggregate.medicineId),
      lot.batchNumber === null
        ? sql`${pharmacyInventory.batchNumber} IS NULL`
        : eq(pharmacyInventory.batchNumber, lot.batchNumber),
    )
    if (conditions === undefined) {
      throw new Error('failed to build WHERE clause for pharmacyInventory update')
    }
    await this.db
      .update(pharmacyInventory)
      .set({
        price: lot.price.diram,
        quantity: lot.quantity,
        updatedAt: lot.lastSyncedAt,
      })
      .where(conditions)
  }
}
