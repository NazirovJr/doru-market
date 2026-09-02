/**
 * InMemory-реализация `PharmacySkuMappingRepository` (EP-05, DTJ-146).
 *
 * Только для unit/integration-тестов и R1-бутстрапа. Drizzle-реализация —
 * DTJ-146, `drizzle-pharmacy-sku-mapping.repository.ts`.
 *
 * Хранит состояние в `Map<composite_key, entry>`, где
 * `composite_key = ${pharmacyId}::${internalSku}`. Upsert-семантика
 * повторяет SQL: `ON CONFLICT (pharmacy_id, internal_sku) DO UPDATE`.
 */
import {
  PHARMACY_SKU_MAPPING_REPOSITORY,
  type PharmacySkuMappingEntry,
  type PharmacySkuMappingRepository,
} from '@/modules/inventory/application/ports/pharmacy-sku-mapping.repository.port.js'

export class InMemoryPharmacySkuMappingRepository implements PharmacySkuMappingRepository {
  private readonly store = new Map<string, PharmacySkuMappingEntry>()

  static compositeKey(pharmacyId: string, internalSku: string): string {
    return `${pharmacyId}::${internalSku}`
  }

  findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>> {
    const result = new Map<string, PharmacySkuMappingEntry>()
    for (const sku of skus) {
      const entry = this.store.get(InMemoryPharmacySkuMappingRepository.compositeKey(pharmacyId, sku))
      if (entry !== undefined) {
        result.set(sku, entry)
      }
    }
    return Promise.resolve(result)
  }

  upsert(input: {
    pharmacyId: string
    internalSku: string
    medicineId: string
    matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
  }): Promise<void> {
    const key = InMemoryPharmacySkuMappingRepository.compositeKey(input.pharmacyId, input.internalSku)
    this.store.set(key, { medicineId: input.medicineId, matchedVia: input.matchedVia })
    return Promise.resolve()
  }
}

export const PHARMACY_SKU_MAPPING_INMEMORY_PROVIDER = {
  provide: PHARMACY_SKU_MAPPING_REPOSITORY,
  useClass: InMemoryPharmacySkuMappingRepository,
} as const
