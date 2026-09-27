// Заменяет временный HTTP-мост — delivery публикует событие в outbox, получаем его через DomainEventsRouter.
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import { OrderDeliveredSubscriber } from './order-delivered.subscriber.js'

const EVENT_TYPES = ['OrderDeliveredEvent'] as const

interface OrderDeliveredPayload {
  readonly orderId: string
  readonly deliveredAt: string
}

@Injectable()
export class OrderDeliveredDomainEventHandler implements DomainEventHandler, OnModuleInit {
  public readonly consumerName = 'payments.on-delivered'
  public readonly eventTypes: readonly string[] = EVENT_TYPES

  public constructor(
    @Inject(OrderDeliveredSubscriber) private readonly subscriber: OrderDeliveredSubscriber,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    if (envelope.tenantId === null) {
      throw new Error(`OrderDeliveredDomainEventHandler: событие ${envelope.eventId} без tenantId — invariant violation.`)
    }
    const payload = envelope.payload as unknown as OrderDeliveredPayload
    await this.subscriber.handle({
      tenantId: envelope.tenantId,
      orderId: payload.orderId,
      deliveredAt: new Date(payload.deliveredAt),
      eventId: envelope.eventId,
    })
  }
}
