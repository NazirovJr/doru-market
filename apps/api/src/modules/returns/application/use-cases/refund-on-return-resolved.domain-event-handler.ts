import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import type { ReturnsDomainEvent } from '../ports/returns-outbox.port.js'
import { RefundOnReturnResolvedSubscriber } from './refund-on-return-resolved.subscriber.js'

const EVENT_TYPES = ['ReturnConfirmedEvent', 'ReturnRejectedEvent'] as const

// Адаптер конверта роутера (DomainEventEnvelope) к типизированному входу subscriber'а.
@Injectable()
export class RefundOnReturnResolvedDomainEventHandler implements DomainEventHandler, OnModuleInit {
  public readonly consumerName = 'returns.on-resolved'
  public readonly eventTypes: readonly string[] = EVENT_TYPES

  public constructor(
    @Inject(RefundOnReturnResolvedSubscriber) private readonly subscriber: RefundOnReturnResolvedSubscriber,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    if (envelope.tenantId === null) {
      throw new Error(`RefundOnReturnResolvedDomainEventHandler: событие ${envelope.eventId} без tenantId — invariant violation.`)
    }
    await this.subscriber.handle({
      tenantId: envelope.tenantId,
      eventId: envelope.eventId,
      event: envelope.payload as unknown as ReturnsDomainEvent,
    })
  }
}
