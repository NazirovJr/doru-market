import { Inject, Injectable } from '@nestjs/common'
import { AnalyticsFacade } from '@/modules/analytics/index.js'
import {
  ANALYTICS_FACADE_PORT,
  type AnalyticsFacadePort,
  type RecordOrderPlacedCommand,
} from '@/modules/orders/application/ports/analytics-facade.port.js'

const ORDER_PLACED_EVENT_TYPE = 'order_placed'

@Injectable()
export class AnalyticsFacadeAdapter implements AnalyticsFacadePort {
  constructor(@Inject(AnalyticsFacade) private readonly analyticsFacade: AnalyticsFacade) {}

  async recordOrderPlaced(command: RecordOrderPlacedCommand): Promise<void> {
    await this.analyticsFacade.recordEvent({
      eventType: ORDER_PLACED_EVENT_TYPE,
      tenantId: command.tenantId,
      // product_events.session_id NOT NULL — без телеметрийного sessionId используем orderId
      // (уникален, ни с чем не совпадёт), чтобы order_placed не терялся из-за ValidationError.
      sessionId: command.sessionId ?? command.orderId,
      orderId: command.orderId,
      orderItems: command.orderItems,
    })
  }
}

export const ANALYTICS_FACADE_PORT_PROVIDER = {
  provide: ANALYTICS_FACADE_PORT,
  useClass: AnalyticsFacadeAdapter,
} as const
