/** DTJ-307 (EP-12, SRS-PHT-032/034) — мягкое нарушение SLA сборки: заказ всё ещё `processing` → `SlaBreachedEvent` в outbox. */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'

export interface ReportPickingSlaBreachCommand {
  readonly tenantId: string
  readonly orderId: string
}

export interface ReportPickingSlaBreachResult {
  readonly orderId: string
  readonly status: 'published' | 'skipped'
}

@Injectable()
export class ReportPickingSlaBreachUseCase {
  // eslint-disable-next-line max-params -- 4 порта + Clock, тот же приём, что AcceptOrderUseCase (явные @Inject, граф виден в providers[]).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: ReportPickingSlaBreachCommand): Promise<ReportPickingSlaBreachResult> {
    const order = await this.orderRepository.findById(cmd.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    // Сборка уже завершена, отменена или ещё не начата — нарушения нет, повторный или запоздалый джоб ничего не делает.
    if (order.status !== 'processing') {
      return { orderId: cmd.orderId, status: 'skipped' }
    }
    const slaMinutes = await this.tenancyFacade.getPickupSlaMinutes(cmd.tenantId)
    const event: OrderDomainEvent = {
      type: 'SlaBreachedEvent',
      orderId: order.id,
      entityType: 'pharmacy_order',
      entityId: order.id,
      breachedAt: this.clock.now(),
      slaMinutes,
    }
    await this.unitOfWork.run((tx) => this.ordersOutbox.appendAll(cmd.tenantId, [event], tx))
    return { orderId: cmd.orderId, status: 'published' }
  }
}