import { describe, expect, it, vi } from 'vitest'
import { DeliveryOrdersAdapter } from './delivery-orders.adapter.js'

function buildAdapter(getOrderById: ReturnType<typeof vi.fn>): DeliveryOrdersAdapter {
  const ordersFacade = { getOrderById }
  return new DeliveryOrdersAdapter(ordersFacade as never)
}

describe('DeliveryOrdersAdapter', () => {
  it('делегирует OrdersFacade.getOrderById(tenantId, orderId), маппит id/customerId/status', async () => {
    const getOrderById = vi.fn().mockResolvedValue({
      id: 'order-1',
      customerId: 'customer-1',
      status: 'delivered',
    })
    const adapter = buildAdapter(getOrderById)

    const context = await adapter.getOrderForRating('tenant-1', 'order-1')

    expect(getOrderById).toHaveBeenCalledWith('tenant-1', 'order-1')
    expect(context).toEqual({ orderId: 'order-1', customerId: 'customer-1', status: 'delivered' })
  })

  it('OrdersFacade.getOrderById возвращает null (чужой тенант/несуществующий заказ) -> null', async () => {
    const getOrderById = vi.fn().mockResolvedValue(null)
    const adapter = buildAdapter(getOrderById)

    const context = await adapter.getOrderForRating('tenant-1', 'unknown-order')

    expect(context).toBeNull()
  })

  it('markOrderDelivered делегирует OrdersFacade.markDelivered(orderId, {tenantId, now})', async () => {
    const markDelivered = vi.fn().mockResolvedValue(undefined)
    const adapter = new DeliveryOrdersAdapter({ markDelivered } as never)
    const now = new Date('2026-09-25T10:00:00.000Z')

    await adapter.markOrderDelivered({ orderId: 'order-1', tenantId: 'tenant-1', now })

    expect(markDelivered).toHaveBeenCalledWith('order-1', { tenantId: 'tenant-1', now })
  })
})
