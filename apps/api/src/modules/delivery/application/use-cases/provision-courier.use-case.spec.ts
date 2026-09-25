import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { ProvisionCourierUseCase } from './provision-courier.use-case.js'

const NOW = new Date('2026-09-05T10:00:00.000Z')
const CHAIN_A = '11111111-1111-1111-1111-111111111111'

function buildHarness(existing: Courier | null = null) {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const findByUserIdMock = vi.fn<CourierRepositoryPort['findByUserId']>().mockResolvedValue(existing)
  const couriers: CourierRepositoryPort = { findById: vi.fn(), findByUserId: findByUserIdMock, save: saveMock }
  const ids: IdGenerator = { next: () => 'courier-generated-id' }
  const clock: Clock = { now: () => NOW }
  const useCase = new ProvisionCourierUseCase(couriers, ids, clock)
  return { useCase, findByUserIdMock, saveMock }
}

describe('ProvisionCourierUseCase (DTJ-364)', () => {
  it('нет существующей строки → создаёт Courier (pending_verification, chain_employee/foot) и сохраняет', async () => {
    const { useCase, saveMock } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', chainId: CHAIN_A })

    expect(result).toEqual({ id: 'courier-generated-id', userId: 'user-1', chainId: CHAIN_A, vehicleType: 'foot', taxStatus: 'chain_employee' })
    expect(saveMock).toHaveBeenCalledOnce()
  })

  it('идемпотентно: уже провижининжена → возвращает существующую, save НЕ вызывается', async () => {
    const existing = Courier.create({ id: 'existing-1', userId: 'user-1', chainId: CHAIN_A, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
    const { useCase, saveMock } = buildHarness(existing)

    const result = await useCase.execute({ userId: 'user-1', chainId: CHAIN_A })

    expect(result.id).toBe('existing-1')
    expect(result.taxStatus).toBe('individual_patent')
    expect(saveMock).not.toHaveBeenCalled()
  })
})
