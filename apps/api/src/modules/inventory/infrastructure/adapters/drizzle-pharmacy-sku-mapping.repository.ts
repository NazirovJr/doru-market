/**
 * Drizzle-реализация `PharmacySkuMappingRepository` (EP-05, DTJ-146).
 *
 * Батчевые запросы:
 *   - `findManyByPharmacyAndSkus` — ОДИН `SELECT ... WHERE pharmacy_id = $1 AND internal_sku = ANY($2)`,
 *     не «по одному в цикле» (SRS-INV-052 п.1).
 *   - `upsert` — `INSERT ... ON CONFLICT (pharmacy_id, internal_sku) DO UPDATE SET medicine_id=excluded.medicine_id, matched_via=excluded.matched_via, matched_at=now()`
 *     (SRS-INV-023).
 *
 * Зависит от Drizzle-инстанса, передаваемого извне (см.
 * `infrastructure/database/drizzle.provider.ts`).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { pharmacySkuMapping } from '@/db/schema/pharmacy-sku-mapping.js'
import {
  PHARMACY_SKU_MAPPING_REPOSITORY,
  type PharmacySkuMappingEntry,
  type PharmacySkuMappingRepository,
} from '../../application/ports/pharmacy-sku-mapping.repository.port.js'

/**
 * Минимальный контракт Drizzle, который мы используем. Заменим на
 * `import { type DrizzleDb } from 'drizzle-orm/...'` при появлении
 * публичного алиаса в проекте (типизация `drizzle-orm` пока не
 * экспортирует единый `DrizzleDb` тип).
 */
interface DrizzleLike {
  select: <T>(args: T) => {
    from: (table: unknown) => {
      where: (condition: SQL) => Promise<
        readonly {
          internalSku: string
          medicineId: string
          matchedVia: string
        }[]
      >
    }
  }
  insert: (table: unknown) => {
    values: (values: Record<string, unknown>) => {
      onConflictDoUpdate: (config: {
        target: readonly unknown[]
        set: Record<string, unknown>
      }) => Promise<void>
    }
  }
}

export class DrizzlePharmacySkuMappingRepository implements PharmacySkuMappingRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>> {
    if (skus.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select({
        internalSku: pharmacySkuMapping.internalSku,
        medicineId: pharmacySkuMapping.medicineId,
        matchedVia: pharmacySkuMapping.matchedVia,
      })
      .from(pharmacySkuMapping)
      .where(
        and(
          eq(pharmacySkuMapping.pharmacyId, pharmacyId),
          inArray(pharmacySkuMapping.internalSku, skus as string[]),
        )!,
      )
    const result = new Map<string, PharmacySkuMappingEntry>()
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] as {
        internalSku: string
        medicineId: string
        matchedVia: string
      }
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

