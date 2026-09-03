/**
 * `InventoryFacadeAdapter` (EP-09, DTJ-227) — реальная реализация `InventoryFacadePort`.
 * Заменяет `UnimplementedInventoryFacadeAdapter` (`orders.module.ts`, TODO(DTJ-227), D-EP09-19).
 *
 * **Нет публичного фасада `modules/inventory/index.ts`** (foundIssue, отчёт сдачи — проверено
 * `grep`: ни одного файла `modules/inventory/index.ts`, ни класса `InventoryFacade`, ни
 * методов `reserveStock`/`releaseStock`/`getStockQuantity`/`hasExpiredReservedBatch` нигде в
 * модуле `inventory`; бриф CTO §«Реальные фасады уже написаны» ошибочен на этот счёт — прямая
 * проверка опровергает). Строить полноценный `InventoryFacade` внутри `modules/inventory/**`
 * (FEFO-агрегат, `PharmacyInventory.applyDelta`, DTJ-148/154) — работа ЧУЖОГО модуля (EP-05),
 * вне периметра DTJ-227. Вместо этого — прямые Drizzle-запросы к `pharmacy_inventory`
 * (таблица, не `modules/inventory/**` — depcruise `no-cross-module-deep-import` запрещает
 * импорт `modules/inventory/application|domain|infrastructure/**`, но НЕ `db/schema/**`,
 * которая вне `modules/**` и уже используется этим же модулем для FK, `db/schema/orders.ts`),
 * тот же приём, что `DrizzleCartRepository` работает с `cart`/`cart_items` напрямую.
 *
 * **FEFO — ОДИН лот на позицию, не разбивка по нескольким.** `OrderItem.inventoryBatchId`
 * (домен, DTJ-221) — ОДНО поле, не массив: агрегат структурно не умеет представить позицию,
 * покрытую двумя партиями по разным ценам. Поэтому `reserveStock` ищет САМЫЙ РАННИЙ по
 * `expires_at` лот, у которого `quantity` В ОДИНОЧКУ покрывает весь запрошенный `quantity`;
 * если такого нет (даже если СУММА нескольких лотов достаточна) — `INSUFFICIENT_STOCK`. Это
 * упрощение задокументировано в отчёте сдачи (`disputed`) — полноценная разбивка по лотам
 * потребовала бы либо смены доменной модели `OrderItem` (вне `files_owned` DTJ-227:
 * `order-item.entity.ts` — DTJ-221), либо отдельной сущности «строка резерва» — за периметром.
 *
 * `SELECT ... FOR UPDATE` держит блокировку строки лота до конца транзакции ГРУППЫ
 * (`tx`, `OrdersUnitOfWorkPort.run`) — конкурентный checkout на тот же лот блокируется, не
 * гонка (SRS-ORD-023, частично; полная матрица гонок — DTJ-231, вне периметра).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import { ErrorCode } from '@dorutj/contracts'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { orderItems } from '@/db/schema/orders.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadeError,
  type InventoryFacadePort,
  type ReleaseStockItemCommand,
  type ReserveStockItemCommand,
  type ReservedStockLine,
} from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'
import { resolveDrizzleClient } from '@/modules/orders/infrastructure/repositories/drizzle-tx.util.js'

interface SelectedBatchRow {
  readonly id: string
  readonly price: number
  readonly quantity: number
}

@Injectable()
export class InventoryFacadeAdapter implements InventoryFacadePort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async reserveStock(
    pharmacyId: string,
    items: readonly ReserveStockItemCommand[],
    tx?: OrderUnitOfWorkTx,
  ): Promise<Result<readonly ReservedStockLine[], InventoryFacadeError>> {
    const client = resolveDrizzleClient(this.db, tx)
    const lines: ReservedStockLine[] = []
    /* eslint-disable no-await-in-loop -- ОДНО pg-соединение на весь цикл (переданный `tx`/`client`,
       node-postgres не поддерживает конкурентные запросы на одном клиенте) — параллелизация через
       `Promise.all` физически невозможна, а FEFO/`FOR UPDATE`-блокировка по КАЖДОЙ позиции обязана
       применяться строго последовательно, иначе гонка на одном лоте между позициями ЭТОЙ ЖЕ группы. */
    for (const item of items) {
      const batch = await this.selectAndLockFefoBatch(client, pharmacyId, item)
      if (batch === null) {
        return err({ code: ErrorCode.INSUFFICIENT_STOCK, medicineId: item.medicineId })
      }
      await client
        .update(pharmacyInventory)
        .set({ quantity: batch.quantity - item.quantity, updatedAt: new Date() })
        .where(eq(pharmacyInventory.id, batch.id))
      lines.push({
        medicineId: item.medicineId,
        inventoryBatchId: batch.id,
        quantity: item.quantity,
        unitPriceDiram: BigInt(batch.price),
      })
    }
    /* eslint-enable no-await-in-loop */
    return ok(lines)
  }

  async releaseStock(items: readonly ReleaseStockItemCommand[], tx?: OrderUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    /* eslint-disable no-await-in-loop -- то же одно pg-соединение, что в `reserveStock` выше —
       node-postgres не поддерживает конкурентные запросы на одном клиенте. */
    for (const item of items) {
      await client
        .update(pharmacyInventory)
        .set({ quantity: sql`${pharmacyInventory.quantity} + ${item.quantity}`, updatedAt: new Date() })
        .where(eq(pharmacyInventory.id, item.inventoryBatchId))
    }
    /* eslint-enable no-await-in-loop */
  }

  /** SRS-DOM-006 (REQ-REG-6) — читает лот, реально зарезервированный под этот заказ. */
  async hasExpiredReservedBatch(orderId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: pharmacyInventory.id })
      .from(orderItems)
      .innerJoin(pharmacyInventory, eq(pharmacyInventory.id, orderItems.inventoryBatchId))
      .where(and(eq(orderItems.orderId, orderId), sql`${pharmacyInventory.expiresAt} <= CURRENT_DATE`))
      .limit(1)
    return rows.length > 0
  }

  /** D-EP09-12 — только для показа (`AvailabilityCalculator`), НИКОГДА не источник истины резерва. */
  async getStockQuantity(pharmacyId: string, medicineId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${pharmacyInventory.quantity}), 0)` })
      .from(pharmacyInventory)
      .where(
        and(
          eq(pharmacyInventory.pharmacyId, pharmacyId),
          eq(pharmacyInventory.medicineId, medicineId),
          sql`${pharmacyInventory.expiresAt} > CURRENT_DATE`,
        ),
      )
    return Number(rows[0]?.total ?? '0')
  }

  /** См. «FEFO — ОДИН лот на позицию» в JSDoc файла — самый ранний лот, покрывающий `quantity` целиком. */
  private async selectAndLockFefoBatch(
    client: DrizzleDb,
    pharmacyId: string,
    item: ReserveStockItemCommand,
  ): Promise<SelectedBatchRow | null> {
    const rows = await client
      .select({ id: pharmacyInventory.id, price: pharmacyInventory.price, quantity: pharmacyInventory.quantity })
      .from(pharmacyInventory)
      .where(
        and(
          eq(pharmacyInventory.pharmacyId, pharmacyId),
          eq(pharmacyInventory.medicineId, item.medicineId),
          sql`${pharmacyInventory.expiresAt} > CURRENT_DATE`,
          sql`${pharmacyInventory.quantity} >= ${item.quantity}`,
        ),
      )
      .orderBy(pharmacyInventory.expiresAt)
      .limit(1)
      .for('update')
    return rows[0] ?? null
  }
}

export const INVENTORY_FACADE_PORT_PROVIDER = {
  provide: INVENTORY_FACADE_PORT,
  useClass: InventoryFacadeAdapter,
} as const
