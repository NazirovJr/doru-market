import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { Courier } from '../../domain/courier.entity.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierPayoutsRepositoryPort, FindCourierPayoutsInput } from '../ports/courier-payouts.repository.port.js'
import { GetCourierPayoutsUseCase, type GetCourierPayoutsInput } from './get-courier-payouts.use-case.js'

const NOW = new Date('2026-09-06T10:00:00.000Z')
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'

function makeCourier(): Courier {
  return Courier.create({
    id: COURIER_ID,
    userId: USER_ID,
    chainId: null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
}

function makeUseCase(params: { readonly courier: Courier | null }): {
  useCase: GetCourierPayoutsUseCase
  findPage: ReturnType<typeof vi.fn>
} {
  const findPage = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  const payouts: CourierPayoutsRepositoryPort = { findPage }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier),
    findByUserId: vi.fn().mockResolvedValue(params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  return { useCase: new GetCourierPayoutsUseCase(payouts, couriers), findPage }
}

function baseInput(overrides: Partial<GetCourierPayoutsInput> = {}): GetCourierPayoutsInput {
  return { role: 'courier', userId: USER_ID, filterCourierId: null, limit: 20, cursor: null, ...overrides }
}

describe('GetCourierPayoutsUseCase', () => {
  it('courier: implicit own scope — resolve courierId из userId', async () => {
    const { useCase, findPage } = makeUseCase({ courier: makeCourier() })

    await useCase.execute(baseInput({ role: 'courier', filterCourierId: 'someone-elses-id' }))

    const [call] = findPage.mock.calls[0] as [FindCourierPayoutsInput]
    expect(call.courierId).toBe(COURIER_ID)
  })

  it('courier: не найден по userId -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })
    await expect(useCase.execute(baseInput({ role: 'courier' }))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('super_admin БЕЗ filter[courierId] -> courierId=null (все батчи) — В ОТЛИЧИЕ от courier-earnings', async () => {
    const { useCase, findPage } = makeUseCase({ courier: null })

    await useCase.execute(baseInput({ role: 'super_admin', filterCourierId: null }))

    const [call] = findPage.mock.calls[0] as [FindCourierPayoutsInput]
    expect(call.courierId).toBeNull()
  })

  it('super_admin с filter[courierId] -> использует переданный courierId напрямую', async () => {
    const { useCase, findPage } = makeUseCase({ courier: null })

    await useCase.execute(baseInput({ role: 'super_admin', filterCourierId: 'other-courier' }))

    const [call] = findPage.mock.calls[0] as [FindCourierPayoutsInput]
    expect(call.courierId).toBe('other-courier')
  })

  it('роль вне courier/super_admin (оборонительный fallback) -> ForbiddenError', async () => {
    const { useCase } = makeUseCase({ courier: null })
    await expect(useCase.execute(baseInput({ role: 'pharmacy_admin' }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('маппинг: bigint totalAmountDiram/cashRemittanceOffsetDiram -> number на границе DTO', async () => {
    const { useCase, findPage } = makeUseCase({ courier: makeCourier() })
    findPage.mockResolvedValueOnce({
      items: [
        {
          id: 'p1',
          courierId: COURIER_ID,
          periodStart: NOW,
          periodEnd: NOW,
          totalAmountDiram: 100_000n,
          cashRemittanceOffsetDiram: 5_000n,
          status: 'draft' as const,
          issuedAt: null,
          paidAt: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
    })

    const result = await useCase.execute(baseInput())

    expect(result.items[0]).toEqual({
      id: 'p1',
      courierId: COURIER_ID,
      periodStart: NOW,
      periodEnd: NOW,
      totalAmountDiram: 100_000,
      cashRemittanceOffsetDiram: 5_000,
      status: 'draft',
      issuedAt: null,
      paidAt: null,
    })
  })
})
