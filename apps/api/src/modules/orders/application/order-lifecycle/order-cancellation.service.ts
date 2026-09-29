import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isErr } from '@dorutj/domain-kernel'
import type { OrderPaymentMethod, OrderStatus } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { REFUND_FACADE_PORT, type RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderCancelActor, OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'

// Статусы, в которых деньги (non-cash) уже захвачены в эскроу (D-25).
const ESCROW_CAPTURED_STATUSES = new Set<OrderStatus>(['paid_escrow', 'processing'])

export interface CancelWithRefundInput {
  /** Заказ до отмены: статус и способ оплаты определяют, нужен ли рефанд. */
  readonly order: Order
  readonly reason: OrderCancelReason
  readonly actor: OrderCancelActor
  readonly now: Date
}

export interface CancelWithRefundResult {
  readonly refundRequired: boolean
  /** `true`, только если рефанд прошёл сразу; иначе его доведёт обработчик события отмены. */
  readonly refundIssued: boolean
}

export function isRefundRequired(preStatus: OrderStatus, paymentMethod: OrderPaymentMethod): boolean {
  return paymentMethod !== 'cash_courier' && ESCROW_CAPTURED_STATUSES.has(preStatus)
}

// Отмена, возврат остатка и событие для рефанда — одной транзакцией: «отменён ⇒ рефанд будет выполнен»
// без сетевого вызова банка внутри tx. Быстрый рефанд после коммита — лишь ускорение, гарантию даёт outbox.
@Injectable()
export class OrderCancellationService {
  // eslint-disable-next-line max-params -- 5 портов + PINO_LOGGER, явные @Inject (DTJ-001), тот же состав, что был у use case'ов отмены.
  public constructor(
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly outbox: OrdersOutboxPort,
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(REFUND_FACADE_PORT) private readonly refundFacade: RefundFacadePort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async cancel(input: CancelWithRefundInput): Promise<CancelWithRefundResult> {
    const { order, reason, actor, now } = input
    const refundRequired = isRefundRequired(order.status, order.paymentMethod)
    const releaseItems = order.items.map((item) => ({ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity }))

    await this.unitOfWork.run(async (tx) => {
      await this.ordersFacade.cancel(order.id, { tenantId: order.tenantId, reason, actor, now }, tx)
      await this.inventoryFacade.releaseStock(releaseItems, tx)
      await this.outbox.appendAll(
        order.tenantId,
        [
          {
            type: 'OrderCancelledEvent',
            orderId: order.id,
            reason,
            cancelledBy: actor.kind === 'user' ? actor.userId : null,
            at: now,
            refundRequired,
          },
        ],
        tx,
      )
    })

    const refundIssued = refundRequired && (await this.tryRefund(order.id, reason))
    return { refundRequired, refundIssued }
  }

  private async tryRefund(orderId: string, reason: OrderCancelReason): Promise<boolean> {
    try {
      const result = await this.refundFacade.refundFull(orderId, reason)
      if (!isErr(result)) return true
      this.logger.warn({ orderId, cause: result.error }, 'order_refund_deferred_to_outbox')
    } catch (error) {
      this.logger.warn({ orderId, err: error }, 'order_refund_deferred_to_outbox')
    }
    return false
  }
}
