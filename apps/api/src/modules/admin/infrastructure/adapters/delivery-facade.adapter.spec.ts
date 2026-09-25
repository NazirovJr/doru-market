import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import type { CourierRepositoryPort } from '@/modules/delivery/index.js'
import { DeliveryFacadeAdapter } from './delivery-facade.adapter.js'

const NOW = new Date('2026-09-05T10:00:00.000Z')
const CHAIN_A = '11111111-1111-1111-1111-111111111111'

function buildHarness() {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const findByUserIdMock = vi.fn<CourierRepositoryPort['findByUserId']>().mockResolvedValue(null)
  const couriers: CourierRepositoryPort = { findById: vi.fn(), findByUserId: findByUserIdMock, save: saveMock }
  const ids: IdGenerator = { next: () => 'courier-generated-id' }
  const clock: Clock = { now: () => NOW }
  const adapter = new DeliveryFacadeAdapter(couriers, ids, clock)
  return { adapter, findByUserIdMock, saveMock }
}

describe('DeliveryFacadeAdapter (DTJ-364)', () => {
  it('createCourier: Courier.create() статус pending_verification, дефолты chain_employee/foot, сохраняет через репозиторий', async () => {
    const { adapter, saveMock } = buildHarness()

    const result = await adapter.createCourier({ userId: 'user-1', chainId: CHAIN_A })

    expect(result).toEqual({ id: 'courier-generated-id', userId: 'user-1', chainId: CHAIN_A, vehicleType: 'foot', taxStatus: 'chain_employee' })
    expect(saveMock).toHaveBeenCalledOnce()
  })

  it('findCourierByUserId: делегирует репозиторию, null если не найден', async () => {
    const { adapter, findByUserIdMock } = buildHarness()

    const result = await adapter.findCourierByUserId('missing-user')

    expect(findByUserIdMock).toHaveBeenCalledWith('missing-user')
    expect(result).toBeNull()
  })
})
