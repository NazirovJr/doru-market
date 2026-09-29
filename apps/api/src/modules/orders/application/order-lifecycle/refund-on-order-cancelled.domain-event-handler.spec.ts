import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '@dorutj/domain-kernel'
import { ErrorCode, PaymentProviderUnavailableError, type DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry } from '@/common/events/domain-event-handler.js'
import type { RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import { RefundOnOrderCancelledDomainEventHandler } from './refund-on-order-cancelled.domain-event-handler.js'

function envelope(payload: Record<string, unknown>): DomainEventEnvelope {
  return {
    eventId: 'evt-1',
    eventType: 'OrderCancelledEvent',
    aggregateType: 'order',
    aggregateId: 'order-1',
    tenantId: 'tenant-1',
    occurredAt: '2026-09-29T10:00:00.000Z',
    payload,
  }
}

function makeHandler(refundFull: RefundFacadePort['refundFull']) {
  const registry = new DomainEventHandlerRegistry()
  const handler = new RefundOnOrderCancelledDomainEventHandler({ refundFull, refundPartialFulfillment: vi.fn() }, registry)
  return { handler, registry }
}

describe('RefundOnOrderCancelledDomainEventHandler', () => {
  it('onModuleInit регистрирует себя на OrderCancelledEvent', () => {
    const { handler, registry } = makeHandler(vi.fn())

    handler.onModuleInit()

    expect(registry.getHandlersFor('OrderCancelledEvent')).toEqual([handler])
  })

  it('refundRequired=true -> рефанд по заказу с причиной отмены', async () => {
    const refundFull = vi.fn<RefundFacadePort['refundFull']>().mockResolvedValue(ok(undefined))
    const { handler } = makeHandler(refundFull)

    await handler.handle(envelope({ orderId: 'order-1', reason: 'pickup_sla_timeout', refundRequired: true }))

    expect(refundFull).toHaveBeenCalledWith('order-1', 'pickup_sla_timeout')
  })

  it.each([false, undefined])('refundRequired=%s -> рефанд не вызывается', async (refundRequired) => {
    const refundFull = vi.fn<RefundFacadePort['refundFull']>()
    const { handler } = makeHandler(refundFull)

    await handler.handle(envelope({ orderId: 'order-1', reason: 'customer_changed_mind', refundRequired }))

    expect(refundFull).not.toHaveBeenCalled()
  })

  it('рефанд вернул Err -> бросает, чтобы BullMQ повторил job', async () => {
    const refundFull = vi
      .fn<RefundFacadePort['refundFull']>()
      .mockResolvedValue(err({ code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' }))
    const { handler } = makeHandler(refundFull)

    await expect(handler.handle(envelope({ orderId: 'order-1', reason: 'payment_timeout', refundRequired: true }))).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    )
  })
})
