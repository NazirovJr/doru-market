/**
 * `Order`/`OrderItem` → `packages/contracts` DTO (EP-09, DTJ-221 «Что сделать» п.7). Вынесено
 * из `order.entity.ts`/`order-item.entity.ts` — presentation-слой последующих тикетов читает
 * ТОЛЬКО отсюда, домен не импортирует `packages/contracts` DTO-типы в свои же файлы сущностей.
 *
 * `courierId`/`courierEtaMinutes` — колонки есть в БД (`11-database-schema.md`), но ни один
 * метод DTJ-221/222 их не устанавливает (владение — `delivery`, EP-13, будущая волна) —
 * маппер отдаёт `null`, реальные значения появятся, когда `Order` научится их хранить.
 */
import type { OrderDto, OrderItemDto } from '@dorutj/contracts'
import type { Order } from './order.entity.js'
import type { OrderItem } from './order-item.entity.js'

export function toOrderDto(order: Order): OrderDto {
  const s = order.toSnapshot()
  return {
    id: s.id,
    orderNumber: s.orderNumber.value,
    tenantId: s.tenantId,
    customerId: s.customerId,
    pharmacyId: s.pharmacyId,
    status: s.status,
    paymentMethod: s.paymentMethod,
    billingStrategy: s.billingStrategy,
    itemsTotalDiram: Number(s.itemsTotal.diram),
    deliveryFeeDiram: Number(s.deliveryFee.diram),
    totalAmountDiram: Number(s.totalAmount.diram),
    deliveryAddress: s.deliveryAddress,
    deliveryLandmark: s.deliveryLandmark,
    deliveryLatitude: s.deliveryGeoPoint === null ? null : s.deliveryGeoPoint.latitude,
    deliveryLongitude: s.deliveryGeoPoint === null ? null : s.deliveryGeoPoint.longitude,
    courierId: null,
    courierEtaMinutes: null,
    cancelReason: s.cancelReason,
    slaDeadlineAt: toIsoOrNull(s.slaDeadlineAt),
    processingStartedAt: toIsoOrNull(s.processingStartedAt),
    pickedUpAt: toIsoOrNull(s.pickedUpAt),
    deliveredAt: toIsoOrNull(s.deliveredAt),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString()
}

export function toOrderItemDto(item: OrderItem, orderId: string): OrderItemDto {
  const s = item.toSnapshot()
  return {
    id: s.id,
    orderId,
    medicineId: s.medicineId,
    unitPriceDiram: Number(s.unitPrice.diram),
    quantity: s.quantity,
    totalPriceDiram: Number(s.totalPrice.diram),
    commissionBps: s.commissionBps,
    platformFeeDiram: Number(s.platformFeeDiram),
    // DTJ-302/303 — прогресс сборки терминалом фармацевта, см. JSDoc `OrderItemDto`.
    fulfillmentStatus: s.fulfillmentStatus,
    scannedBatchId: s.scannedBatchId,
    scannedAt: toIsoOrNull(s.scannedAt),
    scannedBy: s.scannedBy,
    scanMethod: s.scanMethod,
    itemIssueReason: s.itemIssueReason,
  }
}
