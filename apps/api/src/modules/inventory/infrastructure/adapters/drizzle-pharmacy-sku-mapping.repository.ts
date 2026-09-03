/**
 * Drizzle-реализация `PharmacySkuMappingRepository` (EP-05, DTJ-146).
 *
 * Батчевые запросы:
 *   - `findManyByPharmacyAndSkus` — ОДИН `SELECT ... WHERE pharmacy_id = $1 AND internal_sku = ANY($2)`,
 *     не «по одному в цикле» (SRS-INV-052 п.1).
 *   - `upsert` — `INSERT ... ON CONFLICT (pharmacy_id, internal_sku) DO UPDATE SET medicine_id=excluded.medicine_id, matched_via=excluded.matched_via, matched_at=now()`
 *     (SRS-INV-023).
 *
 * DI: `@Inject(DRIZZLE_DB)` явный (esbuild/vitest не эмитит
 * `design:paramtypes`, DTJ-001, тот же приём, что в
 * `DrizzleFullSyncCompletionAdapter`) — без него, до волны 5, класс не был
 * подключён как провайдер DI вообще (`inventory.module.ts` продолжал
 * биндить `PHARMACY_SKU_MAPPING_REPOSITORY` на InMemory), поэтому
 * написанный код никогда не резолвился Nest'ом.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacySkuMapping } from '@/db/schema/pharmacy-sku-mapping.js'
import {
  PHARMACY_SKU_MAPPING_REPOSITORY,
  type PharmacySkuMappingEntry,
  type PharmacySkuMappingRepository,
} from '@/modules/inventory/application/ports/pharmacy-sku-mapping.repository.port.js'

@Injectable()
export class DrizzlePharmacySkuMappingRepository implements PharmacySkuMappingRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>> {
    if (skus.length === 0) {
      return new Map()
    }
    const conditions = and(
      eq(pharmacySkuMapping.pharmacyId, pharmacyId),
      inArray(pharmacySkuMapping.internalSku, skus as string[]),
    )
    const rows = await this.db
      .select({
        internalSku: pharmacySkuMapping.internalSku,
        medicineId: pharmacySkuMapping.medicineId,
        matchedVia: pharmacySkuMapping.matchedVia,
      })
      .from(pharmacySkuMapping)
      .where(conditions ?? sql`false`)
    const result = new Map<string, PharmacySkuMappingEntry>()
    for (const row of rows as readonly {
      internalSku: string
      medicineId: string
      matchedVia: string
    }[]) {
      if (
        row.matchedVia !== 'barcode' &&
        row.matchedVia !== 'name_fuzzy' &&
        row.matchedVia !== 'manual_resolve'
      ) {
        continue
      }
      result.set(row.internalSku, { medicineId: row.medicineId, matchedVia: row.matchedVia })
    }
    return result
  }

  async upsert(input: {
    pharmacyId: string
    internalSku: string
    medicineId: string
    matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
  }): Promise<void> {
    await this.db
      .insert(pharmacySkuMapping)
      .values({
        pharmacyId: input.pharmacyId,
        internalSku: input.internalSku,
        medicineId: input.medicineId,
        matchedVia: input.matchedVia,
      })
      .onConflictDoUpdate({
        target: [pharmacySkuMapping.pharmacyId, pharmacySkuMapping.internalSku],
        set: {
          medicineId: input.medicineId,
          matchedVia: input.matchedVia,
          matchedAt: sql`now()`,
        },
      })
  }
}

export const PHARMACY_SKU_MAPPING_DRIZZLE_PROVIDER = {
  provide: PHARMACY_SKU_MAPPING_REPOSITORY,
  useClass: DrizzlePharmacySkuMappingRepository,
} as const

