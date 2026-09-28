import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ListOrdersAnyUseCase } from './list-orders-any.use-case.js'
import type { OrdersAnyPage, OrdersFacadePort } from '../ports/orders-facade.port.js'

function fakeFacade(page: OrdersAnyPage): { facade: OrdersFacadePort; findOrdersAny: ReturnType<typeof vi.fn> } {
  const findOrdersAny = vi.fn().mockResolvedValue(page)
  return { facade: { findOrdersAny, getOrderDetail: vi.fn(), getOrderTimeline: vi.fn(), cancel: vi.fn() }, findOrdersAny }
}

const EMPTY_PAGE: OrdersAnyPage = { items: [], nextCursor: null, hasMore: false }

describe('ListOrdersAnyUseCase (DTJ-355)', () => {
  it('super_admin — пробрасывает filter/limit/cursor в порт без изменений', async () => {
    const page: OrdersAnyPage = {
      items: [
        {
          id: 'order-1',
          orderNumber: 'DTJ-260927-00001',
          status: 'processing',
          tenantId: 'tenant-1',
          pharmacyId: 'pharmacy-1',
          customerId: 'customer-1',
          paymentMethod: 'alif_mobi',
          totalAmountDiram: 10_000,
          slaBreached: false,
          createdAt: new Date('2026-09-27T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
    const { facade, findOrdersAny } = fakeFacade(page)
    const useCase = new ListOrdersAnyUseCase(facade)

    const result = await useCase.execute({
      actor: { role: 'super_admin' },
      filter: { orderNumberLike: 'DTJ-260927' },
      limit: 20,
      cursor: { v: '2026-09-27T00:00:00.000Z', id: 'order-0' },
    })

    expect(findOrdersAny).toHaveBeenCalledWith(
      { orderNumberLike: 'DTJ-260927' },
      { limit: 20, cursor: { v: '2026-09-27T00:00:00.000Z', id: 'order-0' } },
    )
    expect(result.items[0]?.id).toBe('order-1')
  })

  it('курсор не передан — cursor: null уходит в порт (не undefined)', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersAnyUseCase(facade)

    await useCase.execute({ actor: { role: 'super_admin' }, filter: {}, limit: 20 })

    expect(findOrdersAny).toHaveBeenCalledWith({}, { limit: 20, cursor: null })
  })

  it('АС4 — pharmacy_admin (не super_admin) — CrossTenantAccessDeniedError, порт НЕ вызывается', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersAnyUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin' }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findOrdersAny).not.toHaveBeenCalled()
  })

  it('АС4 — pharmacist — тот же отказ (защита в глубину, помимо RolesGuard)', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersAnyUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacist' }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(findOrdersAny).not.toHaveBeenCalled()
  })
})
