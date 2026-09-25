import { describe, expect, it, vi } from 'vitest'
import type { DeliveryFacade } from '@/modules/delivery/index.js'
import { DeliveryFacadeAdapter } from './delivery-facade.adapter.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'
const SNAPSHOT = { id: 'courier-1', userId: 'user-1', chainId: CHAIN_A, vehicleType: 'foot', taxStatus: 'chain_employee' } as const

function buildHarness() {
  const provisionCourierMock = vi.fn<DeliveryFacade['provisionCourier']>().mockResolvedValue(SNAPSHOT)
  const facade = { provisionCourier: provisionCourierMock } as unknown as DeliveryFacade
  const adapter = new DeliveryFacadeAdapter(facade)
  return { adapter, provisionCourierMock }
}

describe('DeliveryFacadeAdapter (DTJ-364)', () => {
  it('provisionCourier: делегирует DeliveryFacade.provisionCourier() без изменений', async () => {
    const { adapter, provisionCourierMock } = buildHarness()

    const result = await adapter.provisionCourier({ userId: 'user-1', chainId: CHAIN_A })

    expect(provisionCourierMock).toHaveBeenCalledWith({ userId: 'user-1', chainId: CHAIN_A })
    expect(result).toEqual(SNAPSHOT)
  })
})
