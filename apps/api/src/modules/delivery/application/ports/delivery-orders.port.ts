import type { GeoPoint } from '@/shared-kernel/index.js'

export const DELIVERY_ORDERS_PORT = Symbol.for('@dorutj/delivery/orders-facade')

export interface OrderRatingContext {
  readonly orderId: string
  readonly customerId: string
  readonly status: string
}

/** DTJ-315 — см. `OrdersFacade.getDeliverySnapshot` (tenant-независимый, `orderId` — единственный вход). */
export interface DeliveryOrderContext {
  readonly orderId: string
  readonly tenantId: string
  readonly pharmacyId: string
  readonly medicineIds: readonly string[]
  readonly itemsCount: number
  readonly paymentMethod: string
  readonly deliveryGeoPoint: GeoPoint | null
}

export interface DeliveryOrdersPort {
  getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null>
  getDeliveryContext(orderId: string): Promise<DeliveryOrderContext | null>
}
