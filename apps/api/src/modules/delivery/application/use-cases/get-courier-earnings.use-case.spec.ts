import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@dorutj/contracts'
import { Courier } from '../../domain/courier.entity.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierEarningsRepositoryPort, FindCourierEarningsInput } from '../ports/courier-earnings.repository.port.js'
import { GetCourierEarningsUseCase, type GetCourierEarningsInput } from './get-courier-earnings.use-case.js'

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
  useCase: GetCourierEarningsUseCase
  findPage: ReturnType<typeof vi.fn>
} {
  const findPage = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  const earnings: CourierEarningsRepositoryPort = { findPage }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier),
    findByUserId: vi.fn().mockResolvedValue(params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  return { useCase: new GetCourierEarningsUseCase(earnings, couriers), findPage }
}

function baseInput(overrides: Partial<GetCourierEarningsInput> = {}): GetCourierEarningsInput {
  return { role: 'courier', userId: USER_ID, filterCourierId: null, limit: 20, cursor: null, ...overrides }
}

describe('GetCourierEarningsUseCase', () => {
  it('courier: implicit own scope — resolve courierId из userId, filterCourierId игнорируется', async () => {
    const { useCase, findPage } = makeUseCase({ courier: makeCourier() })

    await useCase.execute(baseInput({ role: 'courier', filterCourierId: 'someone-elses-id' }))

    const [call] = findPage.mock.calls[0] as [FindCourierEarningsInput]
    expect(call.courierId).toBe(COURIER_ID)
  })

  it('courier: не найден по userId -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })
    await expect(useCase.execute(baseInput({ role: 'courier' }))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('super_admin БЕЗ filter[courierId] -> ValidationError (400 по ERROR_HTTP_STATUS)', async () => {
    const { useCase, findPage } = makeUseCase({ courier: null })

    await expect(useCase.execute(baseInput({ role: 'super_admin', filterCourierId: null }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(findPage).not.toHaveBeenCalled()
  })

  it('super_admin с filter[courierId] -> использует переданный courierId напрямую (без lookup)', async () => {
    const { useCase, findPage } = makeUseCase({ courier: null })

    await useCase.execute(baseInput({ role: 'super_admin', filterCourierId: 'other-courier' }))

    const [call] = findPage.mock.calls[0] as [FindCourierEarningsInput]
    expect(call.courierId).toBe('other-courier')
  })

  it('роль вне courier/super_admin (оборонительный fallback) -> ForbiddenError', async () => {
    const { useCase } = makeUseCase({ courier: null })
    await expect(
      useCase.execute(baseInput({ role: 'pharmacist', filterCourierId: 'x' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('маппинг: bigint amountDiram -> number на границе DTO', async () => {
    const { useCase, findPage } = makeUseCase({ courier: makeCourier() })
    findPage.mockResolvedValueOnce({
      items: [{ id: 'e1', amountDiram: 5_000n, isReturnFee: false, recognizedAt: NOW, payoutBatchId: null }],
      nextCursor: { v: NOW.toISOString(), id: 'e1' },
      hasMore: true,
    })

    const result = await useCase.execute(baseInput())

    expect(result.items).toEqual([{ id: 'e1', amountDiram: 5000, isReturnFee: false, recognizedAt: NOW, payoutBatchId: null }])
    expect(result.hasMore).toBe(true)
  })
})
