/**
 * In-memory `PharmacyInventoryRepository` (EP-05, DTJ-148) — заглушка для R1.
 * Drizzle-реализация — в DTJ-154. Mock семантически ТОЧНО воспроизводит
 * upsert по (pharmacyId, medicineId, batchNumber, expiresAt) и счётчики
 * accepted/updated.
 */
import { Injectable } from '@nestjs/common'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
  type UpsertResult,
} from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import { type InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'
import { PharmacyInventory } from '@/modules/inventory/domain/pharmacy-inventory.entity.js'

interface InventoryKey {
  readonly pharmacyId: string
  readonly medicineId: string
  readonly batchNumber: string
  readonly expiresAt: string
}

@Injectable()
export class InMemoryPharmacyInventoryRepository implements PharmacyInventoryRepository {
  private readonly rows = new Map<string, InventoryBatchUpsertRow>()
  private readonly aggregates = new Map<string, PharmacyInventory>()

  async upsertMany(input: {
    pharmacyId: string
    rows: readonly InventoryBatchUpsertRow[]
  }): Promise<UpsertResult> {
    let accepted = 0
    let updated = 0
    for (const row of input.rows) {
      const key = this.makeKey(input.pharmacyId, row)
      if (this.rows.has(key)) {
        updated += 1
      } else {
        accepted += 1
      }
      this.rows.set(key, row)
    }
    return Promise.resolve({ acceptedCount: accepted, updatedCount: updated })
  }

  async findOrCreateManyByMedicineIds(input: {
    pharmacyId: string
    medicineIds: readonly string[]
  }): Promise<ReadonlyMap<string, PharmacyInventory>> {
    const result = new Map<string, PharmacyInventory>()
    for (let i = 0; i < input.medicineIds.length; i += 1) {
      const medicineId = input.medicineIds[i]!
      const key = `${input.pharmacyId}::${medicineId}`
      let aggregate = this.aggregates.get(key)
      if (aggregate === undefined) {
        const created = PharmacyInventory.create({
          id: key,
          pharmacyId: input.pharmacyId,
          medicineId,
        })
        if (!created.ok) {
          throw new Error(`failed to create PharmacyInventory: ${created.error.message}`)
        }
        this.aggregates.set(key, created.value)
        aggregate = created.value
      }
      result.set(medicineId, aggregate)
    }
    return result
  }

  async saveMany(aggregates: readonly PharmacyInventory[]): Promise<void> {
    for (let i = 0; i < aggregates.length; i += 1) {
      const aggregate = aggregates[i]!
      const key = `${aggregate.pharmacyId}::${aggregate.medicineId}`
      this.aggregates.set(key, aggregate)
    }
  }

  private makeKey(pharmacyId: string, row: InventoryBatchUpsertRow): string {
    const key: InventoryKey = {
      pharmacyId,
      medicineId: row.getMedicineId(),
      batchNumber: row.getBatchNumber() ?? '',
      expiresAt: row.getExpiresAt(),
    }
    return `${key.pharmacyId}|${key.medicineId}|${key.batchNumber}|${key.expiresAt}`
  }
}

export { PHARMACY_INVENTORY_REPOSITORY }
