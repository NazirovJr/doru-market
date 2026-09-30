import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import type { DeliveryFacade } from '@/modules/delivery/index.js'
import type { ReturnsRepositoryPort } from '@/modules/returns/application/ports/returns-repository.port.js'
import { ReturnsDeliveryFacadeAdapter } from './returns-delivery-facade.adapter.js'

const TENANT_ID = 'tenant-1'

function makeAdapter(found: { orderId: string } | null) {
  const delivery = {
    suggestReturnCourier: vi.fn().mockResolvedValue({ courierId: 'c-1', etaMinutes: null }),
    calculateReturnFee: vi.fn().mockResolvedValue(2500n),
  }
  const repository = { findById: vi.fn().mockResolvedValue(found) } as unknown as ReturnsRepositoryPort
  return { adapter: new ReturnsDeliveryFacadeAdapter(delivery as unknown as DeliveryFacade, repository), delivery }
}

describe('ReturnsDeliveryFacadeAdapter', () => {
  it('calculateReturnFee: делегирует тариф фасаду delivery', async () => {
    const { adapter, delivery } = makeAdapter(null)

    expect(await adapter.calculateReturnFee(TENANT_ID, 'order-1')).toBe(2500n)
    expect(delivery.calculateReturnFee).toHaveBeenCalledWith({ tenantId: TENANT_ID, orderId: 'order-1' })
  })

  it('assignReturnCourier: резолвит заказ возврата и запрашивает подбор курьера', async () => {
    const { adapter, delivery } = makeAdapter({ orderId: 'order-1' })

    expect(await adapter.assignReturnCourier(TENANT_ID, 'return-1')).toEqual({ courierId: 'c-1', etaMinutes: null })
    expect(delivery.suggestReturnCourier).toHaveBeenCalledWith({ tenantId: TENANT_ID, orderId: 'order-1' })
  })

  it('assignReturnCourier: возврат не найден -> NotFoundError, delivery не вызывается', async () => {
    const { adapter, delivery } = makeAdapter(null)

    await expect(adapter.assignReturnCourier(TENANT_ID, 'missing')).rejects.toBeInstanceOf(NotFoundError)
    expect(delivery.suggestReturnCourier).not.toHaveBeenCalled()
  })
})
