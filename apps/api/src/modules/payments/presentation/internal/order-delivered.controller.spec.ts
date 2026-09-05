import { describe, expect, it, vi } from 'vitest'
import type { OrderDeliveredSubscriber } from '@/modules/payments/infrastructure/subscribers/order-delivered.subscriber.js'
import { OrderDeliveredController } from './order-delivered.controller.js'

describe('OrderDeliveredController (DTJ-244)', () => {
  it('маппит orderId (path) + tenantId/deliveredAt/eventId (body) в вызов subscriber.handle', async () => {
    const handle = vi.fn().mockResolvedValue(undefined)
    const subscriber = { handle } as unknown as OrderDeliveredSubscriber
    const controller = new OrderDeliveredController(subscriber)

    const response = await controller.delivered('order-1', {
      tenantId: 'tenant-1',
      deliveredAt: '2026-09-04T10:00:00.000Z',
      eventId: 'evt-1',
    })

    expect(handle).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      deliveredAt: new Date('2026-09-04T10:00:00.000Z'),
      eventId: 'evt-1',
    })
    expect(response).toEqual({ data: { received: true } })
  })
})
