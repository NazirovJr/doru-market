import type { Logger } from 'pino'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { OrderCancellationService } from '@/modules/orders/application/order-lifecycle/order-cancellation.service.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { InMemoryOrderRepository } from './in-memory-order-repository.fixture.js'

export const FIXTURE_TX = 'fixture-tx'

export function makeOrderCancellationService(input: {
  readonly repo: InMemoryOrderRepository
  readonly inventoryFacade: InventoryFacadePort
  readonly refundFacade: RefundFacadePort
  readonly appendAll: OrdersOutboxPort['appendAll']
  readonly logger: Logger
}): OrderCancellationService {
  return new OrderCancellationService(
    { run: (callback) => callback(FIXTURE_TX) },
    { appendAll: input.appendAll },
    new OrdersFacade(input.repo),
    input.inventoryFacade,
    input.refundFacade,
    input.logger,
  )
}
