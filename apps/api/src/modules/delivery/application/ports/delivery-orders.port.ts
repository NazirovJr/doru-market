export const DELIVERY_ORDERS_PORT = Symbol.for('@dorutj/delivery/orders-facade')

export interface OrderRatingContext {
  readonly orderId: string
  readonly customerId: string
  readonly status: string
}

export interface DeliveryOrdersPort {
  getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null>
}
