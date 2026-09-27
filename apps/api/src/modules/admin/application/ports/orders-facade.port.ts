// Сужение OrdersFacade до методов admin (useExisting в admin.module.ts) — методы структурно совпадают, не импортируются напрямую (arch:check).
import type { OrderPaymentMethod, OrderStatus } from '@dorutj/contracts'

export const ORDERS_FACADE_PORT = Symbol.for('@dorutj/admin/orders-facade-port')

export interface OrdersAnyFilter {
  readonly orderNumberLike?: string
  readonly status?: OrderStatus
  readonly tenantId?: string
  readonly pharmacyId?: string
  readonly chainId?: string
  readonly customerId?: string
  readonly createdAtFrom?: Date
  readonly createdAtTo?: Date
  readonly slaBreached?: boolean
}

export interface OrdersCursor {
  readonly v: string
  readonly id: string
}

export interface OrdersPagination {
  readonly limit: number
  readonly cursor?: OrdersCursor | null
}

export interface OrderAdminSummaryView {
  readonly id: string
  readonly orderNumber: string
  readonly status: OrderStatus
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly customerId: string
  readonly paymentMethod: OrderPaymentMethod
  readonly totalAmountDiram: number
  readonly slaBreached: boolean
  readonly createdAt: Date
}

export interface OrdersAnyPage {
  readonly items: readonly OrderAdminSummaryView[]
  readonly nextCursor: OrdersCursor | null
  readonly hasMore: boolean
}

export interface OrderAdminDetailView {
  readonly id: string
  readonly orderNumber: string
  readonly status: OrderStatus
  readonly tenantId: string
  readonly pharmacyId: string
  readonly customerId: string
  readonly paymentMethod: OrderPaymentMethod
  readonly totalAmountDiram: number
  readonly prescriptionId: string | null
  readonly createdAt: Date
}

export interface OrderTimelineView {
  readonly createdAt: Date
  readonly processingStartedAt: Date | null
  readonly pickedUpAt: Date | null
  readonly deliveredAt: Date | null
  readonly slaDeadlineAt: Date | null
  readonly cancelReason: string | null
  readonly updatedAt: Date
}

export interface OrdersFacadePort {
  findOrdersAny(filter: OrdersAnyFilter, pagination: OrdersPagination): Promise<OrdersAnyPage>
  // Несуществующий orderId — null, не throw.
  getOrderDetail(orderId: string): Promise<OrderAdminDetailView | null>
  getOrderTimeline(orderId: string): Promise<OrderTimelineView | null>
}
