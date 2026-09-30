import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import type { OrderStatus } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import type { OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'
import { SystemCancelOrderUseCase } from './system-cancel-order.use-case.js'

// picked_up и дальше уже у курьера/клиента — отмена невозможна (state machine), они идут штатным ходом.
const STATUSES_BY_SCOPE = {
  unpaid: ['pending_payment', 'confirmed'],
  all: ['pending_payment', 'confirmed', 'paid_escrow', 'processing'],
} as const satisfies Record<string, readonly OrderStatus[]>
const CANCEL_REASON: OrderCancelReason = 'pharmacy_suspended'
const PAGE_LIMIT = 100

interface IncompleteOrderRef {
  readonly id: string
  readonly tenantId: string
  readonly status: OrderStatus
}

export type CancelPharmacyOrdersScope = keyof typeof STATUSES_BY_SCOPE

export interface CancelPharmacyIncompleteOrdersResult {
  readonly cancelledOrderIds: readonly string[]
  readonly failedOrderIds: readonly string[]
}

// Идемпотентен: отменённые заказы больше не попадают в выборку, рефанд идёт тем же путём, что системная отмена.
@Injectable()
export class CancelPharmacyIncompleteOrdersUseCase {
  public constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(SystemCancelOrderUseCase) private readonly systemCancel: SystemCancelOrderUseCase,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async execute(pharmacyId: string, scope: CancelPharmacyOrdersScope = 'all'): Promise<CancelPharmacyIncompleteOrdersResult> {
    const cancelledOrderIds: string[] = []
    const failedOrderIds: string[] = []
    for (const order of await this.findIncompleteOrders(pharmacyId, scope)) {
      // eslint-disable-next-line no-await-in-loop -- последовательно: сбой рефанда одного заказа не должен гасить остальные, порядок важен для журнала
      const cancelled = await this.cancelOne(order)
      if (cancelled === 'cancelled') cancelledOrderIds.push(order.id)
      if (cancelled === 'failed') failedOrderIds.push(order.id)
    }
    return { cancelledOrderIds, failedOrderIds }
  }

  private async findIncompleteOrders(pharmacyId: string, scope: CancelPharmacyOrdersScope): Promise<readonly IncompleteOrderRef[]> {
    const found: IncompleteOrderRef[] = []
    for (const status of STATUSES_BY_SCOPE[scope]) {
      let cursor: { readonly v: string; readonly id: string } | null = null
      let hasMore = true
      while (hasMore) {
        // eslint-disable-next-line no-await-in-loop -- курсорная пагинация: следующая страница зависит от предыдущей
        const page = await this.ordersFacade.findOrdersAny({ pharmacyId, status }, { limit: PAGE_LIMIT, cursor })
        found.push(...page.items.map((item) => ({ id: item.id, tenantId: item.tenantId, status: item.status })))
        cursor = page.nextCursor
        hasMore = page.hasMore && cursor !== null
      }
    }
    return found
  }

  private async cancelOne(order: IncompleteOrderRef): Promise<'cancelled' | 'skipped' | 'failed'> {
    try {
      const result = await this.systemCancel.execute({
        tenantId: order.tenantId,
        orderId: order.id,
        expectedFromStatus: order.status,
        reason: CANCEL_REASON,
      })
      return result.status
    } catch (error) {
      this.logger.error({ err: error, orderId: order.id }, 'pharmacy_suspension_order_cancel_failed')
      return 'failed'
    }
  }
}
