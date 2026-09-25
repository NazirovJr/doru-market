import { describe, expect, it, vi } from 'vitest'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry } from '@/common/events/domain-event-handler.js'
import type { CreateDeliveryAssignmentUseCase } from '@/modules/delivery/application/use-cases/create-delivery-assignment.use-case.js'
import { OrderPickedUpEventHandler } from './order-picked-up.handler.js'

function makeEnvelope(orderId: string): DomainEventEnvelope {
  return {
    eventId: 'evt-1',
    eventType: 'OrderPickedUpEvent',
    aggregateType: 'order',
    aggregateId: orderId,
    tenantId: 'tenant-1',
    occurredAt: new Date().toISOString(),
    payload: { orderId, handoverOtpId: 'otp-1', at: new Date().toISOString() },
  }
}

describe('OrderPickedUpEventHandler', () => {
  it('регистрируется в DomainEventHandlerRegistry на onModuleInit, подписан ровно на OrderPickedUpEvent', () => {
    const registry = new DomainEventHandlerRegistry()
    const createAssignment = { execute: vi.fn() } as unknown as CreateDeliveryAssignmentUseCase
    const handler = new OrderPickedUpEventHandler(createAssignment, registry)

    handler.onModuleInit()

    expect(registry.getHandlersFor('OrderPickedUpEvent')).toEqual([handler])
    expect(registry.getHandlersFor('SomeOtherEvent')).toEqual([])
  })

  it('handle() делегирует CreateDeliveryAssignmentUseCase.execute(orderId) из payload', async () => {
    const registry = new DomainEventHandlerRegistry()
    const execute = vi.fn().mockResolvedValue({ created: true, assignmentId: 'a1' })
    const createAssignment = { execute } as unknown as CreateDeliveryAssignmentUseCase
    const handler = new OrderPickedUpEventHandler(createAssignment, registry)

    await handler.handle(makeEnvelope('order-42'))

    expect(execute).toHaveBeenCalledWith('order-42')
  })
})
