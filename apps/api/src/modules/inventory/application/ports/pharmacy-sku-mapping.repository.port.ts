/**
 * Порт `PharmacySkuMappingRepository` (EP-05, DTJ-146, SRS-INV-021..023).
 *
 * Кэш «однажды сматченного» — таблица `pharmacy_sku_mapping` (создана
 * DTJ-141). Хранит связь `(pharmacy_id, internal_sku) → medicine_id` +
 * как было сматчено (`barcode` / `name_fuzzy` / `manual_resolve`) — для
 * аудита модерации.
 *
 * Семантика:
 *   - `findManyByPharmacyAndSkus` — БАТЧЕВЫЙ запрос (SRS-INV-052 п.1):
 *     ОДИН SQL на ВСЕ SKU батча через `WHERE internal_sku = ANY($1)`,
 *     не «по одному в цикле». Возвращает `Map<internalSku, {medicineId, matchedVia}>`.
 *   - `upsert` — `INSERT ... ON CONFLICT (pharmacy_id, internal_sku) DO UPDATE`,
 *     идемпотентен при повторном вызове с тем же `(pharmacyId, internalSku)`.
 *
 * В Drizzle-реализации (DTJ-146) — реальный SQL. В InMemory-реализации —
 * Map<key, value> для тестов. Контракт одинаковый.
 */
export const PHARMACY_SKU_MAPPING_REPOSITORY = Symbol.for(
  '@dorutj/inventory/pharmacy-sku-mapping-repository',
)

export interface PharmacySkuMappingEntry {
  readonly medicineId: string
  /** `'barcode' | 'name_fuzzy' | 'manual_resolve'` — для аудита модерации. */
  readonly matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
}

export interface PharmacySkuMappingRepository {
  /**
   * Батчевый поиск: ОДИН запрос на ВСЕ SKU батча (SRS-INV-052 п.1).
   * Не вызывается по одному в цикле.
   *
   * @param pharmacyId UUID аптеки
   * @param skus внутренние SKU аптеки (например `'SKU-042'`)
   * @returns `Map<internalSku, entry>` — пустая `Map`, если ничего не найдено
   */
  findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>>

  /**
   * Upsert (SRS-INV-023): успешный матч ЛЮБЫМ путём (barcode, fuzzy,
   * manual) записывается в кэш — для последующих синхронизаций той же
   * строки матчинг БЕЗ обращения к medicines.
   */
  upsert(input: {
    pharmacyId: string
    internalSku: string
    medicineId: string
    matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
  }): Promise<void>
}
