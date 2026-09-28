import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ListOrdersOwnUseCase } from './list-orders-own.use-case.js'
import type { OrdersAnyPage, OrdersFacadePort } from '../ports/orders-facade.port.js'

function fakeFacade(page: OrdersAnyPage): { facade: OrdersFacadePort; findOrdersAny: ReturnType<typeof vi.fn> } {
  const findOrdersAny = vi.fn().mockResolvedValue(page)
  return { facade: { findOrdersAny, getOrderDetail: vi.fn(), getOrderTimeline: vi.fn(), cancel: vi.fn() }, findOrdersAny }
}

const EMPTY_PAGE: OrdersAnyPage = { items: [], nextCursor: null, hasMore: false }

describe('ListOrdersOwnUseCase (DTJ-363)', () => {
  it('pharmacy_admin — резолвит chainId СЕРВЕРОМ из actor, добавляет к фильтру', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersOwnUseCase(facade)

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: 'chain-a' }, filter: { status: 'processing' }, limit: 20 })

    expect(findOrdersAny).toHaveBeenCalledWith({ status: 'processing', chainId: 'chain-a' }, { limit: 20, cursor: null })
  })

  it('АС2 — slaBreached-фильтр делегируется порту без локального пересчёта (use case не читает Date.now())', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersOwnUseCase(facade)

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: 'chain-a' }, filter: { slaBreached: true }, limit: 20 })

    expect(findOrdersAny).toHaveBeenCalledWith({ slaBreached: true, chainId: 'chain-a' }, { limit: 20, cursor: null })
  })

  it('§«Что сделать» п.3 — super_admin со scope=own получает ПУСТУЮ страницу, порт НЕ вызывается, без ошибки', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersOwnUseCase(facade)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, filter: {}, limit: 20 })

    expect(result).toEqual(EMPTY_PAGE)
    expect(findOrdersAny).not.toHaveBeenCalled()
  })

  it('pharmacy_admin без chainId в актора (некорректный токен) — CrossTenantAccessDeniedError, порт НЕ вызывается', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersOwnUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin', chainId: null }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findOrdersAny).not.toHaveBeenCalled()
  })

  it('АС3 — customer — CrossTenantAccessDeniedError (защита в глубину, помимо RolesGuard)', async () => {
    const { facade, findOrdersAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListOrdersOwnUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'customer', chainId: null }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findOrdersAny).not.toHaveBeenCalled()
  })
})
