/**
 * `DrizzleOrderRepository` (EP-09, DTJ-227) — реализация `OrderRepositoryPort` поверх
 * `orders`/`order_items` (DTJ-220, `apps/api/src/db/schema/orders.ts`).
 *
 * `save()` — upsert (правило 6 волны 5 — не голый `UPDATE`, `reports/EP09-CTO-BRIEF.md` §6.6):
 * `orders` через `ON CONFLICT (id) DO UPDATE` над ПОЛНЫМ набором колонок (проще и safer, чем
 * частичный SET только «мутирующих после создания» полей — заказ создаётся один раз за
 * checkout, повторный `save()` того же объекта либо создаёт (первый вызов), либо переносит
 * ТЕ ЖЕ значения плюс изменившиеся через state-machine методы поля). `order_items` —
 * `ON CONFLICT (id) DO NOTHING`: позиции неизменяемы после создания (`OrderItem`, DTJ-221,
 * все поля `readonly`), повторная вставка тех же id — no-op, не ошибка.
 *
 * `tx` — `OrderUnitOfWorkTx` (`unknown`), резолвится в конкретный Drizzle-клиент через
 * `resolveDrizzleClient` (см. `drizzle-tx.util.ts`) — тот же паттерн, что `auth`
 * (`DrizzleOtpCodesRepository`, волна 5).
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046, доработка по замечанию CTO): `findById`/
 * `findByCheckoutAttemptId` фильтруют `AND orders.tenant_id = :tenantId` — чужой тенант ⇒
 * `null` (не отдельная ветка «forbidden»: SRS-API-046 требует именно `404`, чужая строка не
 * подтверждается как существующая).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { orders, orderItems, type OrderRow, type OrderItemRow } from '@/db/schema/orders.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { ORDER_CANCEL_REASON_VALUES, type OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'
import { BILLING_STRATEGY_VALUES, type BillingStrategy, type OrderPaymentMethod } from '@dorutj/contracts'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleOrderRepository implements OrderRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return this.hydrate(client, row)
  }

  async findByCheckoutAttemptId(tenantId: string, checkoutAttemptId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(orders)
      .where(and(eq(orders.checkoutAttemptId, checkoutAttemptId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return this.hydrate(client, row)
  }

  async save(order: Order, tx?: OrderUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const s = order.toSnapshot()
    const values = snapshotToOrderInsert(s)
    await client
      .insert(orders)
      .values(values)
      .onConflictDoUpdate({ target: orders.id, set: values })
    if (s.items.length > 0) {
      await client
        .insert(orderItems)
        .values(s.items.map((item) => itemSnapshotToInsert(item, s.id)))
        .onConflictDoNothing({ target: orderItems.id })
    }
  }

  private async hydrate(client: DrizzleDb, row: OrderRow): Promise<Order> {
    const itemRows = await client.select().from(orderItems).where(eq(orderItems.orderId, row.id))
    return Order.restore(rowToSnapshot(row, itemRows))
  }
}

function snapshotToOrderInsert(s: OrderSnapshot) {
  return {
    id: s.id,
    orderNumber: s.orderNumber.value,
    customerId: s.customerId,
    pharmacyId: s.pharmacyId,
    status: s.status,
    paymentMethod: s.paymentMethod,
    billingStrategy: s.billingStrategy,
    paymentTransactionId: s.paymentTransactionId,
    itemsTotalTjs: s.itemsTotal.toDbDecimalTjs(),
    deliveryFeeTjs: s.deliveryFee.toDbDecimalTjs(),
    totalAmountTjs: s.totalAmount.toDbDecimalTjs(),
    deliveryAddress: s.deliveryAddress,
    deliveryLandmark: s.deliveryLandmark,
    deliveryLatitude: s.deliveryGeoPoint === null ? null : s.deliveryGeoPoint.latitude.toString(),
    deliveryLongitude: s.deliveryGeoPoint === null ? null : s.deliveryGeoPoint.longitude.toString(),
    tenantId: s.tenantId,
    prescriptionId: s.prescriptionId,
    cancelReason: s.cancelReason,
    cancelledBy: s.cancelledBy,
    slaDeadlineAt: s.slaDeadlineAt,
    processingStartedAt: s.processingStartedAt,
    pickedUpAt: s.pickedUpAt,
    deliveredAt: s.deliveredAt,
    handoverOtpId: s.handoverOtpId,
    checkoutAttemptId: s.checkoutAttemptId,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
  }
}

function itemSnapshotToInsert(item: OrderSnapshot['items'][number], orderId: string) {
  return {
    id: item.id,
    orderId,
    medicineId: item.medicineId,
    unitPriceTjs: item.unitPrice.toDbDecimalTjs(),
    quantity: item.quantity,
    totalPriceTjs: item.totalPrice.toDbDecimalTjs(),
    commissionBps: item.commissionBps,
    platformFeeDiram: item.platformFeeDiram,
    inventoryBatchId: item.inventoryBatchId,
  }
}

function rowToSnapshot(row: OrderRow, itemRows: readonly OrderItemRow[]): OrderSnapshot {
  if (row.status === null) {
    throw new Error(`orders.status is NULL for order ${row.id} — data integrity violation`)
  }
  if (row.pharmacyId === null) {
    throw new Error(`orders.pharmacy_id is NULL for order ${row.id} — data integrity violation`)
  }
  return {
    id: row.id,
    orderNumber: parseOrderNumberOrThrow(row),
    tenantId: row.tenantId,
    customerId: row.customerId,
    pharmacyId: row.pharmacyId,
    items: itemRows.map(rowToItemSnapshot),
    itemsTotal: Money.fromDbDecimalTjs(row.itemsTotalTjs),
    deliveryFee: Money.fromDbDecimalTjs(row.deliveryFeeTjs),
    totalAmount: Money.fromDbDecimalTjs(row.totalAmountTjs),
    deliveryAddress: row.deliveryAddress,
    deliveryLandmark: row.deliveryLandmark,
    deliveryGeoPoint: rowToGeoPoint(row),
    paymentMethod: row.paymentMethod as OrderPaymentMethod,
    billingStrategy: toBillingStrategyOrThrow(row.billingStrategy, row.id),
    prescriptionId: row.prescriptionId,
    checkoutAttemptId: row.checkoutAttemptId,
    status: row.status,
    paymentTransactionId: row.paymentTransactionId,
    cancelReason: toCancelReasonOrThrow(row.cancelReason, row.id),
    cancelledBy: row.cancelledBy,
    slaDeadlineAt: toDateOrNull(row.slaDeadlineAt),
    processingStartedAt: toDateOrNull(row.processingStartedAt),
    pickedUpAt: toDateOrNull(row.pickedUpAt),
    deliveredAt: toDateOrNull(row.deliveredAt),
    handoverOtpId: row.handoverOtpId,
    createdAt: toDateOrThrow(row.createdAt, row.id, 'created_at'),
    updatedAt: toDateOrThrow(row.updatedAt, row.id, 'updated_at'),
  }
}

/** Вынесено из `rowToSnapshot` ради `max-lines-per-function` (C1, ≤40). */
function parseOrderNumberOrThrow(row: OrderRow): OrderNumber {
  const result = OrderNumber.parse(row.orderNumber)
  if (!result.ok) {
    throw new Error(`orders.order_number "${row.orderNumber}" failed to parse for order ${row.id}`)
  }
  return result.value
}

function rowToItemSnapshot(row: OrderItemRow): OrderSnapshot['items'][number] {
  if (row.orderId === null || row.medicineId === null || row.inventoryBatchId === null) {
    throw new Error(`order_items row ${row.id} missing required reference — data integrity violation`)
  }
  const unitPrice = Money.fromDbDecimalTjs(row.unitPriceTjs)
  return {
    id: row.id,
    medicineId: row.medicineId,
    unitPrice,
    quantity: row.quantity,
    totalPrice: Money.fromDbDecimalTjs(row.totalPriceTjs),
    commissionBps: row.commissionBps,
    platformFeeDiram: row.platformFeeDiram,
    inventoryBatchId: row.inventoryBatchId,
  }
}

function rowToGeoPoint(row: OrderRow): GeoPoint | null {
  if (row.deliveryLatitude === null || row.deliveryLongitude === null) {
    return null
  }
  const result = GeoPoint.create(Number(row.deliveryLatitude), Number(row.deliveryLongitude))
  if (!result.ok) {
    throw new Error(`orders row ${row.id} carries out-of-range delivery coordinates — data integrity violation`)
  }
  return result.value
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value)
}

function toDateOrThrow(value: Date | string | null, orderId: string, column: string): Date {
  if (value === null) {
    throw new Error(`orders.${column} is NULL for order ${orderId} — data integrity violation`)
  }
  return toDate(value)
}

/**
 * `orders.cancel_reason` — `varchar` без DB-CHECK на набор значений (тот же приём, что
 * `payment_method`/`status` — доверие БД в остальных полях допустимо, но `cancel_reason`
 * напрямую попадает в домен как узкий union `OrderCancelReason`, и `Order.restore()` не
 * перепроверяет его (D-25 проверяет только cash/non-cash × status, не эту колонку) — испорченная
 * строка (ручная правка/баг записи) обязана падать здесь громко, а не растекаться по домену
 * как `never`-невозможное по типам, но реально произвольное по рантайму значение.
 */
function toCancelReasonOrThrow(value: string | null, orderId: string): OrderCancelReason | null {
  if (value === null) return null
  if ((ORDER_CANCEL_REASON_VALUES as readonly string[]).includes(value)) {
    return value as OrderCancelReason
  }
  throw new Error(`orders.cancel_reason "${value}" is not a recognized OrderCancelReason for order ${orderId} — data integrity violation`)
}

/**
 * `orders.billing_strategy` — `NOT NULL` + `CHECK` в БД (миграция 0028), но `varchar` без
 * Drizzle-enum — то же обоснование, что `toCancelReasonOrThrow` выше: испорченная строка
 * обязана падать здесь громко, не растекаться по домену как `never`-невозможное по типам, но
 * реально произвольное по рантайму значение.
 */
function toBillingStrategyOrThrow(value: string, orderId: string): BillingStrategy {
  if ((BILLING_STRATEGY_VALUES as readonly string[]).includes(value)) {
    return value as BillingStrategy
  }
  throw new Error(`orders.billing_strategy "${value}" is not a recognized BillingStrategy for order ${orderId} — data integrity violation`)
}

export const ORDER_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: ORDER_REPOSITORY_PORT,
  useClass: DrizzleOrderRepository,
} as const
