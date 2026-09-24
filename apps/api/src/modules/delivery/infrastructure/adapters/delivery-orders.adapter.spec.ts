/**
 * Unit-тест `DeliveryOrdersAdapter` (EP-13, DTJ-321) — тонкая делегация `OrdersFacade.getOrderById`,
 * маппинг `Order` → `OrderRatingContext`. 1:1 приём `orders-facade.adapter.spec.ts` (DTJ-242,
 * `payments`).
 */
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
})
