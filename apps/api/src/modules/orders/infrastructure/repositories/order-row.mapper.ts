/**
 * Snapshot↔row конвертация для `DrizzleOrderRepository` (EP-09, DTJ-227). Вынесено из
 * `order.repository.ts` (max-lines C2, ≤300 строк/файл) — этот файл после мёржа DTJ-301/302/303
 * (EP-12) превысил лимит, чисто механическая правка: перенос функций конвертации
 * snapshot↔row без изменения их поведения. `DrizzleOrderRepository` (класс, Drizzle-клиент)
 * остаётся в `order.repository.ts` — здесь только чистые функции без побочных эффектов/DI.
 *
 * Не путать с `order.mapper.ts` (domain → `OrderDto`, presentation-граница) — этот файл про
 * domain-snapshot ↔ Drizzle-row (infrastructure-граница), разные направления/потребители.
 */
import { type orders, type orderItems, type OrderRow, type OrderItemRow } from '@/db/schema/orders.js'
import type { OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { SCAN_METHOD_VALUES, type ScanMethod } from '@/modules/orders/domain/order-item.entity.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import {
  ORDER_CANCEL_REASON_VALUES,
  ORDER_ITEM_ISSUE_REASON_VALUES,
  type OrderCancelReason,
  type OrderItemIssueReason,
} from '@/modules/orders/domain/order-domain-event.js'
import { BILLING_STRATEGY_VALUES, type BillingStrategy, type OrderPaymentMethod } from '@dorutj/contracts'

export function snapshotToOrderInsert(s: OrderSnapshot): typeof orders.$inferInsert {
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

export function itemSnapshotToInsert(item: OrderSnapshot['items'][number], orderId: string): typeof orderItems.$inferInsert {
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
    // DTJ-302/303 — прогресс сборки терминалом фармацевта (см. JSDoc `order.repository.ts` `save()`).
    fulfillmentStatus: item.fulfillmentStatus,
    scannedBatchId: item.scannedBatchId,
    scannedAt: item.scannedAt,
    scannedBy: item.scannedBy,
    scanMethod: item.scanMethod,
    itemIssueReason: item.itemIssueReason,
  }
}

export function rowToSnapshot(row: OrderRow, itemRows: readonly OrderItemRow[]): OrderSnapshot {
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
    // DTJ-302/303 — `fulfillmentStatus` уже типизирован Drizzle pg-enum'ом (совпадает 1:1 с
    // доменным `OrderItemFulfillmentStatus`, см. `enums.schema.ts`) — каста не требует, в
    // отличие от `scanMethod`/`itemIssueReason` ниже (`varchar` + raw SQL CHECK, не типизированный
    // Drizzle-enum, тот же приём, что `toCancelReasonOrThrow`/`toBillingStrategyOrThrow` выше).
    fulfillmentStatus: row.fulfillmentStatus,
    scannedBatchId: row.scannedBatchId,
    scannedAt: toDateOrNull(row.scannedAt),
    scannedBy: row.scannedBy,
    scanMethod: toScanMethodOrNull(row.scanMethod, row.id),
    itemIssueReason: toItemIssueReasonOrNull(row.itemIssueReason, row.id),
  }
}

/** Вынесено ради `max-lines-per-function` (C1) — та же защита, что `toCancelReasonOrThrow`. */
function toScanMethodOrNull(value: string | null, itemId: string): ScanMethod | null {
  if (value === null) return null
  if ((SCAN_METHOD_VALUES as readonly string[]).includes(value)) {
    return value as ScanMethod
  }
  throw new Error(`order_items.scan_method "${value}" is not a recognized ScanMethod for item ${itemId} — data integrity violation`)
}

/** Вынесено ради `max-lines-per-function` (C1) — та же защита, что `toCancelReasonOrThrow`. */
function toItemIssueReasonOrNull(value: string | null, itemId: string): OrderItemIssueReason | null {
  if (value === null) return null
  if ((ORDER_ITEM_ISSUE_REASON_VALUES as readonly string[]).includes(value)) {
    return value as OrderItemIssueReason
  }
  throw new Error(`order_items.item_issue_reason "${value}" is not a recognized OrderItemIssueReason for item ${itemId} — data integrity violation`)
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
