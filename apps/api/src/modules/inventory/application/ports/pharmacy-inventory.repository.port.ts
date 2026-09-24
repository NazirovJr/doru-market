/**
 * Порт `PharmacyInventoryRepository` (EP-05, DTJ-148, DTJ-154) — read/write
 * контракт для остатков. Полная Drizzle-реализация — в DTJ-154; на этом шаге
 * используется InMemory для R1.
 *
 * Upsert-семантика: (pharmacy_id, medicine_id, batch_number, expires_at) уникальны
 * (FEFO). При совпадении — обновляется `price` и `quantity` (атомарно). Удаление
 * отсутствует; для "нет в наличии" — `quantity = 0`.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6
 * @see docs/tickets/00-INDEX.md DTJ-148, DTJ-154
 */
import type { InventoryBatchUpsertRow } from '../../domain/value-objects/inventory-batch-upsert-row.vo.js'
import type { PharmacyInventory } from '../../domain/pharmacy-inventory.entity.js'
// `UnitOfWorkTx` — через публичный фасад модуля `auth` (D-27, `no-cross-module-deep-import`):
// inventory не имеет собственного UoW-порта, использует чужой через фасад (см. use case JSDoc).
import type { UnitOfWorkTx } from '@/modules/auth/index.js'

export const PHARMACY_INVENTORY_REPOSITORY = Symbol.for('@dorutj/inventory/pharmacy-inventory-repository')

export interface UpsertResult {
  readonly acceptedCount: number
  readonly updatedCount: number
}

// Одна строка курсорного списка — один лот, не агрегат по медикаменту.
export interface PharmacyInventoryListRow {
  readonly inventoryId: string
  readonly medicineId: string
  readonly tradeName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly priceDiram: number
  readonly stockQuantity: number
  readonly batchNumber: string | null
  readonly expiryDate: string
  readonly lastSyncedAt: Date
}

// keyset по (tradeName, id) — tradeName неуникален, id тай-брейк.
export interface ListByPharmacyCursor {
  readonly tradeName: string
  readonly id: string
}

export interface ListByPharmacyResult {
  readonly items: readonly PharmacyInventoryListRow[]
  readonly hasMore: boolean
}

/** Описание одного row'а, который батчевый `upsertMany` принимает от старого use case'а. */
export interface UpsertInput {
  readonly pharmacyId: string
  readonly rows: readonly InventoryBatchUpsertRow[]
}

export interface PharmacyInventoryRepository {
  /**
   * `upsertMany` — для существующего плоского use case (DTJ-148, R1-бутстрап).
   * Сохраняет «голые» строки через set-based `INSERT ... ON CONFLICT DO UPDATE`.
   */
  upsertMany(input: UpsertInput): Promise<UpsertResult>

  /**
   * `findOrCreateManyByMedicineIds` (DTJ-148, SRS-INV-052 п.4) — БАТЧЕВЫЙ поиск
   * существующих `PharmacyInventory`-агрегатов для набора `medicineId` в одной
   * аптеке. Отсутствующие — создаются в `queued`-статусе (без лотов).
   * Возвращает `Map<medicineId, aggregate>`, ВСЕ агрегаты — мутабельные
   * копии, изменения сохраняются через `saveMany`.
   *
   * `tx?` (волна 6, self-deadlock пула соединений, тот же дефект, что чинили
   * в checkout DTJ-231/233): `IngestInventoryBatchWithMatchingUseCase.execute`
   * вызывает этот метод ВНУТРИ `uow.run(tx => ...)` — без `tx` метод просил
   * бы у пула ВТОРОЕ соединение поверх уже удержанного, при конкурентности
   * ≥ размера пула тупик навсегда (см. JSDoc use case'а).
   */
  findOrCreateManyByMedicineIds(input: {
    readonly pharmacyId: string
    readonly medicineIds: readonly string[]
  }, tx?: UnitOfWorkTx): Promise<ReadonlyMap<string, PharmacyInventory>>

  /**
   * `saveMany` (DTJ-148/154) — set-based `UPDATE`/`INSERT` для всех изменённых
   * агрегатов. Вызывающий код накопил deltas через `aggregate.applyDelta(...)`
   * и теперь персистирует их одной транзакцией. `tx?` — см. JSDoc
   * `findOrCreateManyByMedicineIds` выше, тот же self-deadlock-риск.
   */
  saveMany(aggregates: readonly PharmacyInventory[], tx?: UnitOfWorkTx): Promise<void>

  // Сортировка по tradeName ASC, keyset (tradeName, id) — без второго ключа страницы
  // теряют/дублируют строки при совпадающих названиях.
  listByPharmacy(input: {
    readonly pharmacyId: string
    readonly q: string | null
    readonly cursor: ListByPharmacyCursor | null
    readonly limit: number
  }): Promise<ListByPharmacyResult>
}
