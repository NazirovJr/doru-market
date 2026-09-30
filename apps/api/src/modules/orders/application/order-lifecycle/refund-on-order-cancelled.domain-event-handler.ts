import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { isErr } from '@dorutj/domain-kernel'
import { PaymentProviderUnavailableError, type DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import { REFUND_FACADE_PORT, type RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'

// Ошибка роняет job в ретрай BullMQ; повтор безопасен: рефанд идемпотентен по заказу (ledger + ключ провайдера).
@Injectable()
export class RefundOnOrderCancelledDomainEventHandler implements DomainEventHandler, OnModuleInit {
  public readonly consumerName = 'orders.refund-on-cancel'
  public readonly eventTypes: readonly string[] = ['OrderCancelledEvent']

  public constructor(
    @Inject(REFUND_FACADE_PORT) private readonly refundFacade: RefundFacadePort,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    const event = envelope.payload as unknown as Extract<OrderDomainEvent, { type: 'OrderCancelledEvent' }>
    if (event.refundRequired !== true) {
      return
    }
    const result = await this.refundFacade.refundFull(event.orderId, event.reason)
    if (isErr(result)) {
      throw new PaymentProviderUnavailableError({ orderId: event.orderId, cause: result.error })
    }
  }
}
