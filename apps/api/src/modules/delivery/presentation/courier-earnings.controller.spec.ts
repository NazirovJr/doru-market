/**
 * Unit-тест `CourierEarningsController` (EP-13, DTJ-321) — 1:1 приём `get-payouts.controller.spec.ts`
 * (DTJ-252, `payments`): контроллер инстанцируется напрямую, use case — фейк.
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '@dorutj/contracts'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { GetCourierEarningsUseCase } from '../application/use-cases/get-courier-earnings.use-case.js'
import { CourierEarningsController } from './courier-earnings.controller.js'

const COURIER_CLAIMS: JwtClaims = { sub: 'user-1', role: 'courier', tenantId: 'tenant-1', pharmacyId: null, chainId: null, sessionId: 's-1' }

function fakeUseCase(): { useCase: GetCourierEarningsUseCase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  return { useCase: { execute } as unknown as GetCourierEarningsUseCase, execute }
}

describe('CourierEarningsController', () => {
  it('list: передаёт role/userId/filterCourierId/limit/cursor в use case, кодирует meta.pagination.nextCursor', async () => {
    const { useCase, execute } = fakeUseCase()
    execute.mockResolvedValueOnce({
      items: [{ id: 'e1', amountDiram: 1000, isReturnFee: false, recognizedAt: new Date('2026-09-01'), payoutBatchId: null }],
      nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'e1' },
      hasMore: true,
    })
    const controller = new CourierEarningsController(useCase)

    const response = await controller.list(COURIER_CLAIMS, { limit: '10', 'filter[courierId]': 'ignored-for-courier' })

    expect(execute).toHaveBeenCalledWith({
      role: 'courier',
      userId: 'user-1',
      filterCourierId: 'ignored-for-courier',
      limit: 10,
      cursor: null,
    })
    expect(response.data).toHaveLength(1)
    expect(response.meta?.pagination).toMatchObject({ hasMore: true, limit: 10 })
    expect(typeof (response.meta as { pagination: { nextCursor: string } }).pagination.nextCursor).toBe('string')
  })

  it('list: nextCursor=null -> meta.pagination.nextCursor=null (не закодированная пустая строка)', async () => {
    const { useCase } = fakeUseCase()
    const controller = new CourierEarningsController(useCase)

    const response = await controller.list(COURIER_CLAIMS, {})

    expect(response.meta?.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 20 })
  })

  it('list: декодирует cursor query-параметр перед передачей в use case', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierEarningsController(useCase)
    const cursorRaw = encodeCursor({ v: '2026-09-01T00:00:00.000Z', id: 'e0' })

    await controller.list(COURIER_CLAIMS, { cursor: cursorRaw })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cursor: { v: '2026-09-01T00:00:00.000Z', id: 'e0' } }))
  })

  it('filter[courierId] пусто -> filterCourierId=null', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierEarningsController(useCase)

    await controller.list({ ...COURIER_CLAIMS, role: 'super_admin' }, { 'filter[courierId]': '' })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ filterCourierId: null }))
  })
})
