/**
 * `FakeCatalogFacadePort` (EP-09, DTJ-223) — фикстура `CatalogFacadePort` для unit-тестов
 * `AddCartItemUseCase`. Реальный адаптер (поверх `CatalogFacade`, `modules/catalog/index.ts`)
 * заводит DTJ-227 (см. `orders.module.ts` JSDoc) — эта фикстура ТОЛЬКО для тестов, не для
 * боевой проводки.
 *
 * `setSnapshot`/`setSubstances` (доработка DTJ-234, дефект приёмки — `MedicineOrderSnapshot.
 * tradeName` стал ОБЯЗАТЕЛЬНЫМ полем) принимают вход ЛЕГЧЕ, чем сам интерфейс — `tradeName`/
 * имя вещества здесь опциональны с безопасным дефолтом (id как есть). Причина: эта фикстура
 * переиспользуется `checkout.use-case.spec.ts` (чужой периметр, ЗАПРЕЩЕНО трогать по границам
 * этой сессии), где `setSnapshot(...)` вызывается БЕЗ `tradeName` в ~7 местах — те кейсы
 * проверяют цену/Rx/COD, имя препарата им не важно. Ужесточение сигнатуры сломало бы их
 * компиляцию. Тесты, которым важно РЕАЛЬНОЕ имя (`add-cart-item.use-case.spec.ts`,
 * `get-cart.use-case.spec.ts`, мой периметр), передают `tradeName`/имена веществ явно.
 */
import type {
  CatalogFacadePort,
  MedicineOrderSnapshot,
} from '@/modules/orders/application/ports/catalog-facade.port.js'

type SnapshotInput = Omit<MedicineOrderSnapshot, 'tradeName'> & { readonly tradeName?: string }

export interface SubstanceInput {
  readonly substanceId: string
  readonly name?: string
}

export class FakeCatalogFacadePort implements CatalogFacadePort {
  private readonly snapshots = new Map<string, MedicineOrderSnapshot>()
  private readonly substanceSets = new Map<string, ReadonlyMap<string, string>>()
  private readonly barcodeResolutions = new Map<string, string>()

  setSnapshot(snapshot: SnapshotInput): void {
    this.snapshots.set(snapshot.medicineId, { ...snapshot, tradeName: snapshot.tradeName ?? snapshot.medicineId })
  }

  /** DTJ-302 (`[РАСШИРЕНИЕ]` порта) — регистрирует `(pharmacyId, rawBarcode) → medicineId`. */
  setBarcodeResolution(pharmacyId: string, rawBarcode: string, medicineId: string): void {
    this.barcodeResolutions.set(`${pharmacyId}::${rawBarcode}`, medicineId)
  }

  /** Не зарегистрировано `setBarcodeResolution` для этой пары → `null` (нет совпадения). */
  resolveMedicineIdByBarcode(pharmacyId: string, rawBarcode: string): Promise<string | null> {
    return Promise.resolve(this.barcodeResolutions.get(`${pharmacyId}::${rawBarcode}`) ?? null)
  }

  /** `substances` — id-строки (имя дефолтится к id) ИЛИ `{substanceId, name}` для явного имени. */
  setSubstances(medicineId: string, substances: readonly (string | SubstanceInput)[]): void {
    const entries: [string, string][] = substances.map((s) =>
      typeof s === 'string' ? [s, s] : [s.substanceId, s.name ?? s.substanceId],
    )
    this.substanceSets.set(medicineId, new Map(entries))
  }

  getMedicineSnapshot(medicineIds: readonly string[]): Promise<ReadonlyMap<string, MedicineOrderSnapshot>> {
    const out = new Map<string, MedicineOrderSnapshot>()
    for (const id of medicineIds) {
      const snapshot = this.snapshots.get(id)
      if (snapshot !== undefined) out.set(id, snapshot)
    }
    return Promise.resolve(out)
  }

  getSubstanceSet(medicineIds: readonly string[]): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
    const out = new Map<string, ReadonlyMap<string, string>>()
    for (const id of medicineIds) {
      const set = this.substanceSets.get(id)
      if (set !== undefined) out.set(id, set)
    }
    return Promise.resolve(out)
  }
}
