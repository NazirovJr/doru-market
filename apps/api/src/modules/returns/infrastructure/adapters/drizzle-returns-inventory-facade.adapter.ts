/**
 * `DrizzleReturnsInventoryAdapter` (EP-11, DTJ-273) — реализация `ReturnsInventoryPort` через
 * прямую мутацию `pharmacy_inventory` (таблица — нет публичного `modules/inventory/index.ts`,
 * тот же foundIssue, что зафиксирован `InventoryFacadeAdapter` в `orders`, DTJ-227: «прямые
 * Drizzle-запросы... строить полноценный InventoryFacade — работа ЧУЖОГО модуля EP-05»).
 * `releaseStock` того же адаптера — 1:1 прецедент для `quantity + item.quantity`.
 *
 * `disposition !== 'restock'` — остаток НЕ меняется (JSDoc порта: товар уже покинул инвентарь при
 * выдаче), вызов остаётся best-effort аудит-логом, не мутацией.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import {
  RETURNS_INVENTORY_PORT,
  type ReturnsInventoryPort,
  type ReturnsInventoryDisposition,
  type ReturnsRestockItem,
} from '@/modules/returns/application/ports/inventory-facade.port.js'
import type { ReturnsUnitOfWorkTx } from '@/modules/returns/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleReturnsInventoryAdapter implements ReturnsInventoryPort {
  public constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  // eslint-disable-next-line max-params -- сигнатура фиксирована интерфейсом ReturnsInventoryPort.restock (см. inventory-facade.port.ts), не выбор этого файла.
  public async restock(
    tenantId: string,
    orderId: string,
    items: readonly ReturnsRestockItem[],
    disposition: ReturnsInventoryDisposition,
    tx?: ReturnsUnitOfWorkTx,
  ): Promise<void> {
    this.logger.info({ tenantId, orderId, disposition, itemCount: items.length }, 'return_inventory_disposition_recorded')
    if (disposition !== 'restock') {
      return
    }
    const client = resolveDrizzleClient(this.db, tx)
    const restockable = items.filter((item): item is ReturnsRestockItem & { inventoryBatchId: string } => item.inventoryBatchId !== null)
    /* eslint-disable no-await-in-loop -- одно pg-соединение на весь цикл (переданный `tx`), тот же приём, что `InventoryFacadeAdapter.releaseStock` (orders). */
    for (const item of restockable) {
      await client
        .update(pharmacyInventory)
        .set({ quantity: sql`${pharmacyInventory.quantity} + ${item.quantity}`, updatedAt: new Date() })
        .where(eq(pharmacyInventory.id, item.inventoryBatchId))
    }
    /* eslint-enable no-await-in-loop */
  }
}

export const RETURNS_INVENTORY_FACADE_DRIZZLE_PROVIDER = {
  provide: RETURNS_INVENTORY_PORT,
  useClass: DrizzleReturnsInventoryAdapter,
} as const
