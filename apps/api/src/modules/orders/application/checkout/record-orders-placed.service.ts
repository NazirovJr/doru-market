// Вынесено из CheckoutUseCase (файл был на пределе лимита строк) — тот же приём, что DetectPriceDriftService.
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  ANALYTICS_FACADE_PORT,
  type AnalyticsFacadePort,
} from '@/modules/orders/application/ports/analytics-facade.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'

export interface RecordOrdersPlacedInput {
  readonly tenantId: string
  readonly sessionId: string | null
}

@Injectable()
export class RecordOrdersPlacedService {
  private readonly logger = new Logger(RecordOrdersPlacedService.name)

  constructor(@Inject(ANALYTICS_FACADE_PORT) private readonly analyticsFacade: AnalyticsFacadePort) {}

  // Сбой аналитики не должен ронять уже оформленный заказ — catch вокруг вызова порта, warn, без ре-броска.
  async recordAll(orders: readonly Order[], input: RecordOrdersPlacedInput): Promise<void> {
    await Promise.all(orders.map((order) => this.recordOne(order, input)))
  }

  private async recordOne(order: Order, input: RecordOrdersPlacedInput): Promise<void> {
    try {
      await this.analyticsFacade.recordOrderPlaced({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        orderId: order.id,
        orderItems: order.items.map((item) => ({ medicineId: item.medicineId })),
      })
    } catch (error) {
      this.logger.warn(`recordOrderPlaced(orderId="${order.id}") failed: ${String(error)}`)
    }
  }
}
