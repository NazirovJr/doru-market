import { Inject, Injectable } from '@nestjs/common'
import { ORDERS_FACADE, type OrdersFacade } from '@/modules/orders/index.js'
import {
  DELIVERY_ORDERS_PORT,
  type DeliveryOrderContext,
  type DeliveryOrdersPort,
  type MarkOrderDeliveredInput,
  type OrderRatingContext,
  type ReissueHandoverOtpInput,
  type ReissueHandoverOtpOutput,
  type VerifyHandoverOtpInput,
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

  // ДОБАВЛЕНО (DTJ-317) — DeliverUseCase закрывает заказ ЧЕРЕЗ фасад orders, не прямой мутацией.
  public async markOrderDelivered(input: MarkOrderDeliveredInput): Promise<void> {
    await this.ordersFacade.markDelivered(input.orderId, { tenantId: input.tenantId, now: input.now })
  }

  public async verifyHandoverOtp(input: VerifyHandoverOtpInput): Promise<void> {
    await this.ordersFacade.verifyHandoverOtp(input)
  }

  public async reissueHandoverOtp(input: ReissueHandoverOtpInput): Promise<ReissueHandoverOtpOutput> {
    const result = await this.ordersFacade.reissueHandoverOtp(input.orderId, input.actor)
    return { code: result.code, expiresAt: result.expiresAt, handoverOtpId: result.handoverOtpId }
  }
}

export const DELIVERY_ORDERS_PORT_PROVIDER = {
  provide: DELIVERY_ORDERS_PORT,
  useClass: DeliveryOrdersAdapter,
} as const
