import type { GeoPoint } from '@/shared-kernel/index.js'

export const DELIVERY_ORDERS_PORT = Symbol.for('@dorutj/delivery/orders-facade')

export interface OrderRatingContext {
  readonly orderId: string
  readonly customerId: string
  readonly status: string
}

export interface DeliveryOrderContext {
  readonly orderId: string
  readonly tenantId: string
  readonly pharmacyId: string
  readonly customerId: string
  readonly medicineIds: readonly string[]
  readonly itemsCount: number
  readonly paymentMethod: string
  readonly deliveryGeoPoint: GeoPoint | null
  readonly deliveryFeeDiram: bigint
  readonly totalAmountDiram: bigint
  readonly deliveryAddress: string
  readonly deliveryLandmark: string | null
  readonly handoverOtpId: string | null
}

export interface MarkOrderDeliveredInput {
  readonly orderId: string
  readonly tenantId: string
  readonly now: Date
}

export interface DeliveryOrdersPort {
  getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null>
  getDeliveryContext(orderId: string): Promise<DeliveryOrderContext | null>
  markOrderDelivered(input: MarkOrderDeliveredInput): Promise<void>
}
