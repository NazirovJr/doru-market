import { describe, expect, it, vi } from 'vitest'
import { DomainEventHandlerRegistry } from '@/common/events/domain-event-handler.js'
import type { RefundOnReturnResolvedSubscriber } from './refund-on-return-resolved.subscriber.js'
import { RefundOnReturnResolvedDomainEventHandler } from './refund-on-return-resolved.domain-event-handler.js'

describe('RefundOnReturnResolvedDomainEventHandler', () => {
  it('onModuleInit регистрируется в DomainEventHandlerRegistry под своими eventTypes', () => {
    const registry = new DomainEventHandlerRegistry()
    const handler = new RefundOnReturnResolvedDomainEventHandler({} as RefundOnReturnResolvedSubscriber, registry)

    handler.onModuleInit()

    expect(registry.getHandlersFor('ReturnConfirmedEvent')).toEqual([handler])
    expect(registry.getHandlersFor('ReturnRejectedEvent')).toEqual([handler])
    expect(registry.getHandlersFor('order.paid')).toEqual([])
  })

  it('handle маппит DomainEventEnvelope в вызов subscriber.handle', async () => {
    const subscriberHandle = vi.fn().mockResolvedValue(undefined)
    const subscriber = { handle: subscriberHandle } as unknown as RefundOnReturnResolvedSubscriber
    const handler = new RefundOnReturnResolvedDomainEventHandler(subscriber, new DomainEventHandlerRegistry())

    await handler.handle({
      eventId: 'evt-1',
      eventType: 'ReturnConfirmedEvent',
      aggregateType: 'order_return',
      aggregateId: 'return-1',
      tenantId: 'tenant-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { type: 'ReturnConfirmedEvent', returnId: 'return-1', orderId: 'order-1', reason: 'defect', disposition: 'restock' },
    })

    expect(subscriberHandle).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      eventId: 'evt-1',
      event: { type: 'ReturnConfirmedEvent', returnId: 'return-1', orderId: 'order-1', reason: 'defect', disposition: 'restock' },
    })
  })

  it('handle бросает на envelope без tenantId (invariant violation)', async () => {
    const subscriber = { handle: vi.fn() } as unknown as RefundOnReturnResolvedSubscriber
    const handler = new RefundOnReturnResolvedDomainEventHandler(subscriber, new DomainEventHandlerRegistry())

    await expect(
      handler.handle({
        eventId: 'evt-1',
        eventType: 'ReturnConfirmedEvent',
        aggregateType: 'order_return',
        aggregateId: 'return-1',
        tenantId: null,
        occurredAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      }),
    ).rejects.toThrow(/invariant violation/)
  })
})
