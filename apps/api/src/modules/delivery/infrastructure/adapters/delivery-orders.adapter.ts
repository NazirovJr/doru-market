import { Inject, Injectable } from '@nestjs/common'
import { ORDERS_FACADE, type OrdersFacade } from '@/modules/orders/index.js'
import {
  DELIVERY_ORDERS_PORT,
  type DeliveryOrderContext,
  type DeliveryOrdersPort,
  type OrderRatingContext,
} from '@/modules/delivery/application/ports/delivery-orders.port.js'

@Injectable()
export class DeliveryOrdersAdapter implements DeliveryOrdersPort {
  public constructor(@Inject(ORDERS_FACADE) private readonly ordersFacade: OrdersFacade) {}

  public async getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null> {
    const order = await this.ordersFacade.getOrderById(tenantId, orderId)
    if (order === null) {
      return null
    }
    return { orderId: order.id, customerId: order.customerId, status: order.status }
  }

  public async getDeliveryContext(orderId: string): Promise<DeliveryOrderContext | null> {
    return this.ordersFacade.getDeliverySnapshot(orderId)
  }
}

export const DELIVERY_ORDERS_PORT_PROVIDER = {
  provide: DELIVERY_ORDERS_PORT,
  useClass: DeliveryOrdersAdapter,
} as const
