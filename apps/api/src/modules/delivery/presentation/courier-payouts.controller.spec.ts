/**
 * Unit-тест `CourierPayoutsController` (EP-13, DTJ-321) — 1:1 приём `courier-earnings.controller.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { GetCourierPayoutsUseCase } from '../application/use-cases/get-courier-payouts.use-case.js'
import { CourierPayoutsController } from './courier-payouts.controller.js'

const SUPER_ADMIN_CLAIMS: JwtClaims = { sub: 'admin-1', role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null, sessionId: 's-1' }

function fakeUseCase(): { useCase: GetCourierPayoutsUseCase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  return { useCase: { execute } as unknown as GetCourierPayoutsUseCase, execute }
}

describe('CourierPayoutsController', () => {
  it('list: super_admin БЕЗ filter[courierId] -> filterCourierId=null (все батчи, опционален для этой роли)', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierPayoutsController(useCase)

    await controller.list(SUPER_ADMIN_CLAIMS, {})

    expect(execute).toHaveBeenCalledWith({ role: 'super_admin', userId: 'admin-1', filterCourierId: null, limit: 20, cursor: null })
  })

  it('list: passes filter[courierId] through when provided', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierPayoutsController(useCase)

    await controller.list(SUPER_ADMIN_CLAIMS, { limit: '5', 'filter[courierId]': 'courier-9' })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ filterCourierId: 'courier-9', limit: 5 }))
  })

  it('list: кодирует meta.pagination.nextCursor, когда есть следующая страница', async () => {
    const { useCase, execute } = fakeUseCase()
    execute.mockResolvedValueOnce({
      items: [],
      nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'p1' },
      hasMore: true,
    })
    const controller = new CourierPayoutsController(useCase)

    const response = await controller.list(SUPER_ADMIN_CLAIMS, {})

    expect(typeof (response.meta as { pagination: { nextCursor: string } }).pagination.nextCursor).toBe('string')
  })
})
