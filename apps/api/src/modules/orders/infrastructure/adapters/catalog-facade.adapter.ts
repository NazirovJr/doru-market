/**
 * `CatalogFacadeAdapter` (EP-09, DTJ-227) — реальная реализация `CatalogFacadePort` поверх
 * публичного фасада `modules/catalog/index.ts` (`CatalogFacade`, DTJ-096/097). Заменяет
 * `UnimplementedCatalogFacadeAdapter` (`orders.module.ts`, TODO(DTJ-227), D-EP09-19).
 *
 * **`unitPriceDiram` — foundIssue DTJ-220, разрешение этого тикета.** JSDoc порта
 * (`catalog-facade.port.ts`) фиксирует: `CatalogFacade.getMedicineSnapshot` НЕ несёт цены —
 * цена привязана к паре (аптека, медикамент) через `pharmacy_inventory`, а
 * `getMedicineSnapshot(medicineIds)` структурно не принимает `pharmacyId`. Для
 * `CheckoutUseCase` это НЕ проблема: реальная цена ПОЗИЦИИ заказа берётся из
 * `InventoryFacadePort.reserveStock(...).unitPriceDiram` (цена ИМЕННО ТОГО лота, который
 * реально зарезервирован — race-free, см. JSDoc `ReservedStockLine`), НЕ отсюда.
 * `unitPriceDiram` в этом снимке — MIN(price) по непросроченным лотам данного медикамента
 * ЛЮБОЙ аптеки (справочное значение для `GetCartUseCase`/`AddCartItemUseCase`, чтобы
 * `/api/v1/cart` перестал показывать `items: []` для НЕПУСТЫХ корзин — до этого адаптера
 * `getMedicineSnapshot` был null-заглушкой с пустой `Map`, каждая строка исключалась из
 * `GetCartUseCase.assembleRows` из-за `snapshot === undefined`, живой P0-баг). Известное
 * ограничение (foundIssues отчёта сдачи): если один медикамент продаётся в НЕСКОЛЬКИХ
 * аптеках одной корзины по РАЗНЫМ ценам, это поле покажет одну и ту же (минимальную) цену для
 * обеих строк — корректный фикс требует смены сигнатуры `getMedicineSnapshot` на пары
 * `(pharmacyId, medicineId)`, что каскадирует в `AddCartItemUseCase`/`GetCartUseCase`
 * (DTJ-223/225, вне `files_owned` этого тикета) — вне периметра DTJ-227.
 */
import { Inject, Injectable } from '@nestjs/common'
import { gt, inArray, sql } from 'drizzle-orm'
import { CATALOG_FACADE, type CatalogFacade } from '@/modules/catalog/index.js'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import {
  CATALOG_FACADE_PORT,
  type CatalogFacadePort,
  type MedicineOrderSnapshot,
} from '@/modules/orders/application/ports/catalog-facade.port.js'

const ZERO_DIRAM = 0n

@Injectable()
export class CatalogFacadeAdapter implements CatalogFacadePort {
  constructor(
    @Inject(CATALOG_FACADE) private readonly catalogFacade: CatalogFacade,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  async getMedicineSnapshot(medicineIds: readonly string[]): Promise<ReadonlyMap<string, MedicineOrderSnapshot>> {
    if (medicineIds.length === 0) return new Map()
    const [catalogSnapshots, minPrices] = await Promise.all([
      this.catalogFacade.getMedicineSnapshot([...medicineIds]),
      this.resolveReferencePrices([...medicineIds]),
    ])
    const out = new Map<string, MedicineOrderSnapshot>()
    for (const [medicineId, snapshot] of catalogSnapshots) {
      out.set(medicineId, {
        medicineId,
        // DTJ-234 (дефект приёмки): `MedicineSnapshot` каталога уже несёт `tradeName` (проверено
        // — `modules/catalog/index.ts#recordToSnapshot`), просто не копировалось сюда.
        tradeName: snapshot.tradeName,
        unitPriceDiram: minPrices.get(medicineId) ?? ZERO_DIRAM,
        isPrescriptionRequired: snapshot.isPrescriptionRequired,
        controlCategory: snapshot.controlCategory,
      })
    }
    return out
  }

  async getSubstanceSet(medicineIds: readonly string[]): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
    if (medicineIds.length === 0) return new Map()
    const substances = await this.catalogFacade.getSubstances([...medicineIds])
    const out = new Map<string, ReadonlyMap<string, string>>()
    for (const [medicineId, refs] of substances) {
      // DTJ-234 (дефект приёмки): `innName` уже приходит от `CatalogFacade.getSubstances`
      // (`SubstanceRef.innName`) — раньше отбрасывалось при сведении к `Set<substanceId>`,
      // предупреждение `duplicate_substance` не могло назвать вещество.
      out.set(medicineId, new Map(refs.map((ref) => [ref.substanceId, ref.innName])))
    }
    return out
  }

  /** MIN(price) по непросроченным лотам с остатком — см. «ВНИМАНИЕ» в JSDoc файла. Один batch-запрос. */
  private async resolveReferencePrices(medicineIds: string[]): Promise<ReadonlyMap<string, bigint>> {
    const rows = await this.db
      .select({ medicineId: pharmacyInventory.medicineId, minPrice: sql<string>`MIN(${pharmacyInventory.price})` })
      .from(pharmacyInventory)
      .where(sql`${inArray(pharmacyInventory.medicineId, medicineIds)} AND ${gt(pharmacyInventory.quantity, 0)}`)
      .groupBy(pharmacyInventory.medicineId)
    const out = new Map<string, bigint>()
    for (const row of rows) {
      out.set(row.medicineId, BigInt(row.minPrice))
    }
    return out
  }
}

export const CATALOG_FACADE_PORT_PROVIDER = {
  provide: CATALOG_FACADE_PORT,
  useClass: CatalogFacadeAdapter,
} as const
