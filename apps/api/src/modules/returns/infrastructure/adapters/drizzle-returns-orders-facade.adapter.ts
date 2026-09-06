/**
 * `DrizzleReturnsOrdersFacadeAdapter` (EP-11, DTJ-273) — реализация `ReturnsOrdersPort` через
 * прямое чтение `orders`/`order_items`/`pharmacies`/`medicines`/`pharmacy_inventory` (таблицы, не
 * `modules/orders|catalog|inventory/**` — тот же приём, что `DrizzleSupportOrdersFacadeAdapter`/
 * `InventoryFacadeAdapter` в `orders`, см. их JSDoc: чтение чужой Drizzle-схемы из своего
 * `infrastructure` не межмодульный deep-import, `02` §1.1 запрещает только `domain`/`application`).
 *
 * Тенант-скоуп — `WHERE orders.tenant_id = tenantId` ПРЯМО в первом запросе (SRS-API-046: чужой
 * тенант ⇒ `null`, не отдельная проверка постфактум).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq, and } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { orders, orderItems } from '@/db/schema/orders.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { medicines } from '@/db/schema/medicines.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { couriers } from '@/db/schema/couriers.js'
import {
  RETURNS_ORDERS_PORT,
  type ReturnsOrdersPort,
  type OrderReturnContext,
  type ReturnOrderItemSnapshot,
  type ReturnsUnitOfWorkTx,
} from '@/modules/returns/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const BILLING_STRATEGY_VALUES = new Set(['single_invoice', 'split_items_delivery'])

@Injectable()
export class DrizzleReturnsOrdersFacadeAdapter implements ReturnsOrdersPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async getOrderForReturn(
    tenantId: string,
    orderId: string,
    tx?: ReturnsUnitOfWorkTx,
  ): Promise<OrderReturnContext | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select({
        orderId: orders.id,
        status: orders.status,
        pharmacyId: orders.pharmacyId,
        chainId: pharmacies.chainId,
        customerId: orders.customerId,
        paymentMethod: orders.paymentMethod,
        billingStrategy: orders.billingStrategy,
        deliveredAt: orders.deliveredAt,
        courierId: orders.courierId,
        itemsTotalTjs: orders.itemsTotalTjs,
        deliveryFeeTjs: orders.deliveryFeeTjs,
        totalAmountTjs: orders.totalAmountTjs,
      })
      .from(orders)
      .leftJoin(pharmacies, eq(pharmacies.id, orders.pharmacyId))
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    if (row === undefined) {
      return null
    }
    const items = await this.loadItems(client, orderId)
    return toOrderReturnContext(row, items)
  }

  /** DTJ-275 — см. JSDoc `ReturnsOrdersPort.getCourierIdForUser`. `tenantId` не фильтрует
   *  `couriers` напрямую (таблица не тенант-скоупная, платформенный пул), но параметр сохранён
   *  в сигнатуре порта для единообразия с остальными методами (может понадобиться при
   *  мульти-тенантном флоте сетей, R3). */
  public async getCourierIdForUser(_tenantId: string, userId: string, tx?: ReturnsUnitOfWorkTx): Promise<string | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select({ id: couriers.id }).from(couriers).where(eq(couriers.userId, userId)).limit(1)
    return row?.id ?? null
  }

  private async loadItems(client: DrizzleDb, orderId: string): Promise<readonly ReturnOrderItemSnapshot[]> {
    const rows = await client
      .select({
        medicineId: orderItems.medicineId,
        inventoryBatchId: orderItems.inventoryBatchId,
        quantity: orderItems.quantity,
        expiresAt: pharmacyInventory.expiresAt,
        controlCategory: medicines.controlCategory,
      })
      .from(orderItems)
      .leftJoin(pharmacyInventory, eq(pharmacyInventory.id, orderItems.inventoryBatchId))
      .leftJoin(medicines, eq(medicines.id, orderItems.medicineId))
      .where(eq(orderItems.orderId, orderId))
    return rows.map((row) => ({
      medicineId: row.medicineId ?? '',
      inventoryBatchId: row.inventoryBatchId,
      quantity: row.quantity,
      expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt),
      controlCategory: row.controlCategory ?? 'none',
    }))
  }
}

interface OrderReturnHeaderRow {
  readonly orderId: string
  readonly status: string | null
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly customerId: string
  readonly paymentMethod: string
  readonly billingStrategy: string
  readonly deliveredAt: Date | null
  readonly courierId: string | null
  readonly itemsTotalTjs: string
  readonly deliveryFeeTjs: string
  readonly totalAmountTjs: string
}

/** Извлечено из `getOrderForReturn` — C1 (`max-lines-per-function`, порог 40 строк). */
function toOrderReturnContext(row: OrderReturnHeaderRow, items: readonly ReturnOrderItemSnapshot[]): OrderReturnContext {
  return {
    orderId: row.orderId,
    status: row.status ?? 'pending_payment',
    pharmacyId: row.pharmacyId,
    chainId: row.chainId,
    customerId: row.customerId,
    paymentMethod: row.paymentMethod,
    billingStrategy: BILLING_STRATEGY_VALUES.has(row.billingStrategy)
      ? (row.billingStrategy as OrderReturnContext['billingStrategy'])
      : 'single_invoice',
    deliveredAt: row.deliveredAt,
    courierId: row.courierId,
    items,
    itemsTotalDiram: Money.fromDbDecimalTjs(row.itemsTotalTjs).diram,
    deliveryFeeDiram: Money.fromDbDecimalTjs(row.deliveryFeeTjs).diram,
    totalAmountDiram: Money.fromDbDecimalTjs(row.totalAmountTjs).diram,
  }
}

export const RETURNS_ORDERS_FACADE_DRIZZLE_PROVIDER = {
  provide: RETURNS_ORDERS_PORT,
  useClass: DrizzleReturnsOrdersFacadeAdapter,
} as const
