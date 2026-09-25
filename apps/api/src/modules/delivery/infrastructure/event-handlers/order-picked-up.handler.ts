// Payload сверен с реальным order.entity.ts: { orderId, handoverOtpId, at } — НЕ sealedBagConfirmed.
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import { CreateDeliveryAssignmentUseCase } from '@/modules/delivery/application/use-cases/create-delivery-assignment.use-case.js'

const EVENT_TYPES = ['OrderPickedUpEvent'] as const

interface OrderPickedUpPayload {
  readonly orderId: string
}

@Injectable()
export class OrderPickedUpEventHandler implements DomainEventHandler, OnModuleInit {
  public readonly consumerName = 'delivery.on-order-picked-up'
  public readonly eventTypes: readonly string[] = EVENT_TYPES

  public constructor(
    @Inject(CreateDeliveryAssignmentUseCase) private readonly createAssignment: CreateDeliveryAssignmentUseCase,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as OrderPickedUpPayload
    await this.createAssignment.execute(payload.orderId)
  }
}
